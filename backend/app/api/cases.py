import json
import uuid
from datetime import datetime
from io import BytesIO
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .. import ai_case
from ..ai_fix import propose_case_fix
from ..case_versions import diff_text, rollback_case, snapshot_case
from ..db import SessionLocal
from ..deps import (
    CurrentUser,
    DbSession,
    require_case_access,
    require_feature_access,
    require_project_access,
)
from ..environments import DEFAULT_ENVIRONMENT, ensure_default_environment
from ..modelconfig import missing_fields
from ..models import (
    CaseAiDraft,
    CaseResult,
    Feature,
    Iteration,
    Project,
    ProjectEnvironment,
    ProjectFile,
    ProjectModelConfig,
    Run,
    RunBatch,
    Team,
    TestCase,
    TestCaseVersion,
)
from ..quota import ensure_quota, record_usage
from ..schemas import (
    AiFixIn,
    AiFixOut,
    CaseDiffOut,
    CaseDraftIn,
    CaseDraftOut,
    CaseOptionOut,
    CaseTableExportIn,
    CaseVersionOut,
    TestCaseCreate,
    TestCaseOut,
    TestCaseUpdate,
    TrialRunIn,
    TrialRunOut,
    YamlValidateIn,
    YamlValidateOut,
)
from ..testcase_export import build_test_case_workbook, rows_from_yaml
from ..user_names import attach_user_names
from ..yamlcheck import structure_regression
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
            f"该系统还没配好大模型（缺：{'、'.join(gaps)}），无法生成用例。"
            "请先到「系统详情 → 大模型配置」补齐。",
        )
    try:
        await ensure_quota(db, feature.project_id, config)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return feature, config


async def _project_file_context(db, project_id: uuid.UUID) -> list[dict]:
    rows = list(
        (
            await db.execute(
                select(ProjectFile)
                .where(ProjectFile.project_id == project_id)
                .order_by(ProjectFile.key)
            )
        ).scalars()
    )
    seen: dict[str, str] = {}
    for row in rows:
        seen.setdefault(row.key, row.original_name)
    return [{"key": key, "name": name} for key, name in sorted(seen.items())]


@router.post("/api/features/{feature_id}/ai/case-draft", response_model=CaseDraftOut)
async def draft_case_with_ai(
    feature_id: uuid.UUID, body: CaseDraftIn, user: CurrentUser, db: DbSession
) -> CaseDraftOut:
    """通过对话生成用例 YAML。

    用的是**项目上配好的那个模型** —— 和跑用例是同一份配置，所以「这个项目用哪个模型」
    仍然只有一个答案。项目没配好时同样拦住，并说清缺什么。
    """
    feature, config = await _draft_ready(feature_id, user, db)
    files = await _project_file_context(db, feature.project_id)

    try:
        result = await ai_case.draft(
            db,
            config,
            history=[m.model_dump() for m in body.messages],
            current_yaml=body.current_yaml,
            feature_name=feature.name,
            files=files,
            mode=body.mode,
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
        diff=result.diff,
        lock_violated=result.lock_violated,
        steps=result.steps or [],
        description=result.description,
        test_cases=result.test_cases or [],
    )


@router.post("/api/features/{feature_id}/ai/case-draft/stream")
async def draft_case_with_ai_stream(
    feature_id: uuid.UUID, body: CaseDraftIn, user: CurrentUser, db: DbSession
):
    """流式版：边生成边显示，等模型的时间从「干等 30 秒」变成「看着它写」。

    事件：delta（增量文本）/ done（结构化结果，形状同 CaseDraftOut）/ error。
    """
    feature, config = await _draft_ready(feature_id, user, db)
    files = await _project_file_context(db, feature.project_id)

    async def events():
        async for item in ai_case.draft_stream(
            config,
            history=[m.model_dump() for m in body.messages],
            current_yaml=body.current_yaml,
            feature_name=feature.name,
            files=files,
            mode=body.mode,
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


@router.post("/api/features/{feature_id}/ai/trial-run", response_model=TrialRunOut)
async def trial_run(
    feature_id: uuid.UUID, body: TrialRunIn, user: CurrentUser, db: DbSession
) -> TrialRunOut:
    """把当前 YAML 的前 N 步真正跑一遍，拿步骤级结果。

    不落 TestCase、不进批次、不计入统计（Run.is_debug）—— 这是调试通道，
    不是一次正式执行。
    """
    feature, _config = await _draft_ready(feature_id, user, db)
    errors, _ = validate_yaml(body.yaml_content)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "；".join(errors))
    try:
        text = ai_case.truncate_steps(
            body.yaml_content, body.step_limit, body.case_index
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if body.step_options:
        text = ai_case.apply_step_options(
            text, [o.model_dump(exclude_unset=True) for o in body.step_options]
        )
    # 返回的是这次真正会跑的范围（前面的 case + 目标 case 的前 N 步）
    _, case_count = validate_yaml(text)

    project = await db.get(Project, feature.project_id)
    if project is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "功能所属项目不存在")
    env_name = (body.environment_name or "").strip() or DEFAULT_ENVIRONMENT
    env = (
        await db.execute(
            select(ProjectEnvironment).where(
                ProjectEnvironment.project_id == feature.project_id,
                ProjectEnvironment.name == env_name,
            )
        )
    ).scalar_one_or_none()
    if env is None and env_name == DEFAULT_ENVIRONMENT:
        env = await ensure_default_environment(db, feature.project_id)
    if env is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"环境「{env_name}」在该项目下不存在"
        )

    run = Run(
        team_id=project.team_id,
        project_id=feature.project_id,
        status="queued",
        is_debug=True,
        debug_yaml=text,
        debug_step_limit=body.step_limit,
        debug_cache=body.cache,
        environment_id=env.id,
        environment_name=env.name,
        environment_base_url=env.base_url,
        created_by=user.id,
    )
    db.add(run)
    await db.commit()
    return TrialRunOut(
        run_id=run.id, steps=len(ai_case.steps_of(text)), case_count=case_count
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
    return YamlValidateOut(
        ok=not errors,
        errors=errors,
        case_count=case_count,
        steps=ai_case.steps_of(body.yaml_content),
        test_cases=ai_case.test_cases_of(body.yaml_content),
    )


@router.post("/api/features/{feature_id}/test-cases/export")
async def export_test_cases(
    feature_id: uuid.UUID, body: CaseTableExportIn, user: CurrentUser, db: DbSession
):
    """把当前 YAML 展开成客户可读的测试用例表，导出 Excel。"""
    feature = await require_feature_access(db, feature_id, user)
    errors, _ = validate_yaml(body.yaml_content)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "；".join(errors))
    project = await db.get(Project, feature.project_id)
    case_set = (body.case_set_name or "").strip() or feature.name
    rows = rows_from_yaml(
        body.yaml_content,
        system=project.name if project else "",
        feature=feature.name,
        case_set=case_set,
    )
    data = build_test_case_workbook(rows)
    safe = "".join(ch for ch in case_set if ch not in '\\/:*?"<>|').strip()[:80] or "测试用例"
    filename = f"测试用例_{safe}_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/api/projects/{project_id}/cases", response_model=list[CaseOptionOut])
async def list_project_cases(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[TestCase]:
    """任务功能树用：一次取该系统下全部启用用例，避免按功能逐个请求。"""
    await require_project_access(db, project_id, user)
    stmt = (
        select(TestCase)
        .join(Feature, Feature.id == TestCase.feature_id)
        .where(Feature.project_id == project_id, TestCase.is_active.is_(True))
        .order_by(Feature.name, TestCase.priority.nullslast(), TestCase.name)
    )
    return list((await db.execute(stmt)).scalars())


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
    cases = list((await db.execute(stmt)).scalars())
    await attach_user_names(db, cases)
    return cases


@router.post(
    "/api/features/{feature_id}/cases",
    response_model=TestCaseOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_case(
    feature_id: uuid.UUID, body: TestCaseCreate, user: CurrentUser, db: DbSession
) -> TestCaseOut:
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
    data = body.model_dump(exclude={"change_source", "change_note"})
    case = TestCase(
        feature_id=feature_id, created_by=user.id, updated_by=user.id, **data
    )
    db.add(case)
    await db.flush()
    version = await snapshot_case(
        db,
        case,
        source="create",
        note=body.change_note,
        user_id=user.id,
    )
    # 这个功能下的对话草稿跟着新用例走，之后打开「AI 修改用例」还能看到刚才的对话
    draft = (
        await db.execute(
            select(CaseAiDraft).where(
                CaseAiDraft.user_id == user.id, CaseAiDraft.feature_id == feature_id
            )
        )
    ).scalar_one_or_none()
    if draft is not None:
        draft.feature_id = None
        draft.case_id = case.id
    await db.commit()
    case.feature = feature
    await attach_user_names(db, [case])
    out = TestCaseOut.model_validate(case)
    out.version_no = version.version_no
    return out


@router.get("/api/cases/{case_id}", response_model=TestCaseOut)
async def get_case(case_id: uuid.UUID, user: CurrentUser, db: DbSession) -> TestCaseOut:
    case = await require_case_access(db, case_id, user)
    await attach_user_names(db, [case])
    out = TestCaseOut.model_validate(case)
    out.version_no = (
        await db.execute(
            select(func.max(TestCaseVersion.version_no)).where(
                TestCaseVersion.case_id == case.id
            )
        )
    ).scalar()
    return out


@router.patch("/api/cases/{case_id}", response_model=TestCaseOut)
async def update_case(
    case_id: uuid.UUID, body: TestCaseUpdate, user: CurrentUser, db: DbSession
) -> TestCaseOut:
    existing = await require_case_access(db, case_id, user)
    feature = existing.feature
    case = (
        await db.execute(
            select(TestCase)
            .options(selectinload(TestCase.feature))
            .where(TestCase.id == case_id)
            .with_for_update()
        )
    ).scalar_one()
    data = body.model_dump(exclude_unset=True, exclude={"change_source", "change_note"})
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
    if "name" in data and data["name"] != case.name:
        duplicate = (
            await db.execute(
                select(TestCase.id).where(
                    TestCase.feature_id == case.feature_id,
                    TestCase.name == data["name"],
                    TestCase.id != case.id,
                )
            )
        ).first()
        if duplicate is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "该功能下已有同名用例")
    source = body.change_source or "manual"
    if source not in {"manual", "ai_fix"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "非法版本来源")
    if source == "ai_fix" and "yaml_content" in data:
        problem = structure_regression(case.yaml_content, data["yaml_content"])
        if problem:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"AI 修复结果不完整（{problem}），已拒绝保存；请重新生成",
            )
    for field, value in data.items():
        setattr(case, field, value)
    case.updated_by = user.id
    version = await snapshot_case(
        db, case, source=source, note=body.change_note, user_id=user.id
    )
    await db.commit()
    case.feature = feature
    await attach_user_names(db, [case])
    out = TestCaseOut.model_validate(case)
    out.version_no = version.version_no
    return out


@router.delete("/api/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(case_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    case = await require_case_access(db, case_id, user)
    await db.delete(case)
    await db.commit()


@router.get("/api/cases/{case_id}/versions", response_model=list[CaseVersionOut])
async def list_versions(
    case_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    limit: int = 50,
    offset: int = 0,
) -> list[TestCaseVersion]:
    case = await require_case_access(db, case_id, user)
    return list(
        (
            await db.execute(
                select(TestCaseVersion)
                .where(TestCaseVersion.case_id == case.id)
                .order_by(TestCaseVersion.version_no.desc())
                .limit(max(1, min(limit, 200)))
                .offset(max(0, offset))
            )
        ).scalars()
    )


@router.get("/api/cases/{case_id}/versions/diff", response_model=CaseDiffOut)
async def version_diff(
    case_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    from_version: int,
    to_version: int | None = None,
) -> CaseDiffOut:
    case = await require_case_access(db, case_id, user)
    source = (
        await db.execute(
            select(TestCaseVersion).where(
                TestCaseVersion.case_id == case.id,
                TestCaseVersion.version_no == from_version,
            )
        )
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "起始版本不存在")
    if to_version is None:
        target_yaml = case.yaml_content
        target_no = (
            await db.execute(
                select(func.max(TestCaseVersion.version_no)).where(
                    TestCaseVersion.case_id == case.id
                )
            )
        ).scalar() or 0
    else:
        target = (
            await db.execute(
                select(TestCaseVersion).where(
                    TestCaseVersion.case_id == case.id,
                    TestCaseVersion.version_no == to_version,
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "目标版本不存在")
        target_yaml = target.yaml_content
        target_no = target.version_no
    return CaseDiffOut(
        from_version=source.version_no,
        to_version=int(target_no),
        diff=diff_text(
            source.yaml_content,
            target_yaml,
            f"v{source.version_no}",
            f"v{target_no}",
        ),
    )


@router.get(
    "/api/cases/{case_id}/versions/{version_id}", response_model=CaseVersionOut
)
async def get_version(
    case_id: uuid.UUID, version_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> TestCaseVersion:
    case = await require_case_access(db, case_id, user)
    version = await db.get(TestCaseVersion, version_id)
    if version is None or version.case_id != case.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")
    return version


@router.post(
    "/api/cases/{case_id}/versions/{version_id}/rollback",
    response_model=CaseVersionOut,
)
async def rollback_to_version(
    case_id: uuid.UUID, version_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> TestCaseVersion:
    existing = await require_case_access(db, case_id, user)
    case = (
        await db.execute(
            select(TestCase)
            .options(selectinload(TestCase.feature))
            .where(TestCase.id == case_id)
            .with_for_update()
        )
    ).scalar_one()
    version = await db.get(TestCaseVersion, version_id)
    if version is None or version.case_id != case.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")
    errors, _ = validate_yaml(version.yaml_content)
    if errors:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "该版本 YAML 已不符合当前校验规则：" + "; ".join(errors),
        )
    try:
        new_version = await rollback_case(db, case, version, user_id=user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await db.commit()
    case.feature = existing.feature
    return new_version


@router.post("/api/cases/{case_id}/ai-fix", response_model=AiFixOut)
async def ai_fix(
    case_id: uuid.UUID, body: AiFixIn, user: CurrentUser, db: DbSession
) -> AiFixOut:
    case = await require_case_access(db, case_id, user)
    try:
        proposal = await propose_case_fix(db, case, run_id=body.run_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return AiFixOut(
        run_id=proposal.run_id,
        proposed_yaml=proposal.proposed_yaml,
        explanation=proposal.explanation,
        diff=proposal.diff,
        yaml_ok=proposal.yaml_ok,
        yaml_errors=proposal.yaml_errors,
        model_name=proposal.model_name,
    )


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
            Run.is_debug.is_(False),
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
