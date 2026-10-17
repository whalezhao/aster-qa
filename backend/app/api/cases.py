import json
import uuid

import httpx
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .. import ai_case
from ..db import SessionLocal
from ..deps import CurrentUser, DbSession, require_case_access, require_feature_access
from ..modelconfig import missing_fields
from ..models import (
    CaseResult,
    Iteration,
    Project,
    ProjectModelConfig,
    Run,
    RunBatch,
    Team,
    TestCase,
)
from ..quota import ensure_quota, record_usage
from ..schemas import (
    CaseDraftIn,
    CaseDraftOut,
    TestCaseCreate,
    TestCaseOut,
    TestCaseUpdate,
    YamlValidateIn,
    YamlValidateOut,
)
from ..yamlcheck import validate as validate_yaml

router = APIRouter(tags=["cases"])


async def _draft_ready(feature_id, user, db):
    """两条生成路径（一次性 / 流式）共用的前置校验。"""
    feature = await require_feature_access(db, feature_id, user)
    config = await db.get(ProjectModelConfig, feature.project_id)
    gaps = missing_fields(config)
    if gaps:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"该项目还没配好大模型（缺：{'、'.join(gaps)}），无法生成用例。"
            "请先到「项目详情 → 大模型配置」补齐。",
        )
    try:
        await ensure_quota(db, feature.project_id, config)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return feature, config


@router.post("/api/features/{feature_id}/ai/case-draft", response_model=CaseDraftOut)
async def draft_case_with_ai(
    feature_id: uuid.UUID, body: CaseDraftIn, user: CurrentUser, db: DbSession
) -> CaseDraftOut:
    """通过对话生成用例 YAML。

    用的是**项目上配好的那个模型** —— 和跑用例是同一份配置，所以「这个项目用哪个模型」
    仍然只有一个答案。项目没配好时同样拦住，并说清缺什么。
    """
    feature, config = await _draft_ready(feature_id, user, db)

    try:
        result = await ai_case.draft(
            db,
            config,
            history=[m.model_dump() for m in body.messages],
            current_yaml=body.current_yaml,
            feature_name=feature.name,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, _describe_http_error(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"连不上模型服务（{config.base_url}）：{exc.__class__.__name__}。请检查接入地址与网络。",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await record_usage(db, feature.project_id, "case_draft", result.usage)
    await db.commit()

    return CaseDraftOut(
        reply=result.reply,
        yaml=result.yaml_text,
        yaml_ok=result.yaml_ok,
        yaml_errors=result.yaml_errors,
        usage=result.usage,
    )


@router.post("/api/features/{feature_id}/ai/case-draft/stream")
async def draft_case_with_ai_stream(
    feature_id: uuid.UUID, body: CaseDraftIn, user: CurrentUser, db: DbSession
):
    """流式版：边生成边显示，等模型的时间从「干等 30 秒」变成「看着它写」。

    事件：delta（增量文本）/ done（结构化结果，形状同 CaseDraftOut）/ error。
    """
    feature, config = await _draft_ready(feature_id, user, db)

    async def events():
        async for item in ai_case.draft_stream(
            config,
            history=[m.model_dump() for m in body.messages],
            current_yaml=body.current_yaml,
            feature_name=feature.name,
        ):
            if item["event"] == "done":
                tokens = int((item["data"].get("usage") or {}).get("total_tokens") or 0)
                if tokens:
                    # 生成器在响应生命周期里跑，依赖注入的 db 会话不保证还活着，
                    # 用一条独立会话记流水
                    async with SessionLocal() as usage_db:
                        await record_usage(
                            usage_db,
                            feature.project_id,
                            "case_draft",
                            {"total_tokens": tokens},
                        )
                        await usage_db.commit()
            yield (
                f"event: {item['event']}\n"
                f"data: {json.dumps(item['data'], ensure_ascii=False)}\n\n"
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx 之类的反代会缓冲 SSE，显式关掉
            "X-Accel-Buffering": "no",
        },
    )


def _describe_http_error(exc: httpx.HTTPStatusError) -> str:
    """把模型服务的 HTTP 错误翻译成用户能照做的话。

    和执行链路上的失败归因是同一个道理：额度用尽、密钥不对、模型名写错，
    这些都不是「我问得不对」，要明说而不是抛一个裸的 500。
    """
    code = exc.response.status_code
    body = exc.response.text[:300]
    if code == 429 or "usage limit" in body or "quota" in body:
        return "模型调用额度已用尽（上游返回 429）。请更换模型或等额度恢复。"
    if code == 401:
        return "模型拒绝了请求：API Key 无效或已过期。"
    if code == 404:
        return "模型服务返回 404：模型名或接入地址可能不对。"
    return f"模型服务返回 {code}：{body}"


@router.post("/api/cases/validate", response_model=YamlValidateOut)
async def validate_body(body: YamlValidateIn, user: CurrentUser) -> YamlValidateOut:
    """编辑器里实时校验用 —— 不落库、不调 AI，纯本地解析。"""
    errors, case_count = validate_yaml(body.yaml_content)
    return YamlValidateOut(ok=not errors, errors=errors, case_count=case_count)


@router.get("/api/features/{feature_id}/cases", response_model=list[TestCaseOut])
async def list_cases(
    feature_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[TestCase]:
    await require_feature_access(db, feature_id, user)
    stmt = (
        select(TestCase)
        .options(selectinload(TestCase.feature))  # effective_stage 需要
        .where(TestCase.feature_id == feature_id)
        .order_by(TestCase.priority.nullslast(), TestCase.name)
    )
    return list((await db.execute(stmt)).scalars())


@router.post(
    "/api/features/{feature_id}/cases",
    response_model=TestCaseOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_case(
    feature_id: uuid.UUID, body: TestCaseCreate, user: CurrentUser, db: DbSession
) -> TestCase:
    feature = await require_feature_access(db, feature_id, user)
    errors, _ = validate_yaml(body.yaml_content)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errors))
    exists = (
        await db.execute(
            select(TestCase.id).where(
                TestCase.feature_id == feature_id, TestCase.name == body.name
            )
        )
    ).first()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该功能下已有同名用例")
    case = TestCase(feature_id=feature_id, created_by=user.id, **body.model_dump())
    db.add(case)
    await db.commit()
    case.feature = feature
    return case


@router.get("/api/cases/{case_id}", response_model=TestCaseOut)
async def get_case(case_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TestCase:
    return await require_case_access(db, case_id, user)


@router.patch("/api/cases/{case_id}", response_model=TestCaseOut)
async def update_case(
    case_id: uuid.UUID, body: TestCaseUpdate, user: CurrentUser, db: DbSession
) -> TestCase:
    case = await require_case_access(db, case_id, user)
    data = body.model_dump(exclude_unset=True)
    if "yaml_content" in data:
        errors, _ = validate_yaml(data["yaml_content"])
        if errors:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errors))
    if "stage_override" in data and data["stage_override"] not in {
        None,
        "in_iteration",
        "released",
    }:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法分期")
    for field, value in data.items():
        setattr(case, field, value)
    await db.commit()
    return case


@router.delete("/api/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(case_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    case = await require_case_access(db, case_id, user)
    await db.delete(case)
    await db.commit()


@router.get("/api/cases/{case_id}/history")
async def case_history(
    case_id: uuid.UUID, user: CurrentUser, db: DbSession, limit: int = 30
) -> list[dict]:
    """该用例的历史执行结果。

    带上团队/项目/迭代/批次是为了让这一栏能回答「这次跑的是哪儿、属于哪个迭代」——
    只有一个时间和通过与否，看的人没法判断结果是不是自己关心的那次。
    """
    await require_case_access(db, case_id, user)
    stmt = (
        select(
            CaseResult,
            Run,
            Team.name,
            Project.name,
            Iteration.name,
            RunBatch.id,
            RunBatch.name,
        )
        .join(Run, Run.id == CaseResult.run_id)
        .join(Team, Team.id == Run.team_id)
        .outerjoin(Project, Project.id == Run.project_id)
        .outerjoin(Iteration, Iteration.id == Run.iteration_id)
        .outerjoin(RunBatch, RunBatch.id == Run.batch_id)
        .where(
            CaseResult.test_case_id == case_id,
            Run.status.in_(("succeeded", "failed")),
        )
        .order_by(Run.started_at.desc().nullslast())
        .limit(min(limit, 200))
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "run_id": str(run.id),
            "batch_id": str(batch_id) if batch_id else None,
            "batch_name": batch_name,
            "team_name": team_name,
            "project_name": project_name,
            "iteration_name": iteration_name,
            "status": result.status,
            "attempt_count": result.attempt_count,
            "passed_after_retry": result.passed_after_retry,
            "run_status": run.status,
            "failure_kind": run.failure_kind,
            "model_name": run.model_name,
            "duration_ms": run.duration_ms,
            "report_available": bool(run.report_html_path),
            "started_at": run.started_at.isoformat() if run.started_at else None,
        }
        for (
            result,
            run,
            team_name,
            project_name,
            iteration_name,
            batch_id,
            batch_name,
        ) in rows
    ]
