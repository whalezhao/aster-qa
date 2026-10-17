import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select, update

from ..deps import (
    CurrentUser,
    DbSession,
    require_feature_access,
    require_project_access,
)
from ..models import Feature, TestCase
from ..schemas import BulkIds, FeatureCreate, FeatureOut, FeatureUpdate, ReleaseIn

router = APIRouter(tags=["features"])


@router.get("/api/projects/{project_id}/features", response_model=list[FeatureOut])
async def list_features(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    stage: str | None = None,
) -> list[Feature]:
    await require_project_access(db, project_id, user)
    stmt = select(Feature).where(Feature.project_id == project_id)
    if stage:
        stmt = stmt.where(Feature.stage == stage)
    stmt = stmt.order_by(Feature.stage, Feature.name)
    return list((await db.execute(stmt)).scalars())


@router.post(
    "/api/projects/{project_id}/features",
    response_model=FeatureOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_feature(
    project_id: uuid.UUID, body: FeatureCreate, user: CurrentUser, db: DbSession
) -> Feature:
    await require_project_access(db, project_id, user, "member")
    exists = (
        await db.execute(
            select(Feature.id).where(
                Feature.project_id == project_id, Feature.name == body.name
            )
        )
    ).first()
    if exists is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "该项目下已有同名功能")
    feature = Feature(project_id=project_id, created_by=user.id, **body.model_dump())
    db.add(feature)
    await db.commit()
    await db.refresh(feature)
    return feature


@router.get("/api/features/{feature_id}", response_model=FeatureOut)
async def get_feature(feature_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Feature:
    return await require_feature_access(db, feature_id, user)


@router.patch("/api/features/{feature_id}", response_model=FeatureOut)
async def update_feature(
    feature_id: uuid.UUID, body: FeatureUpdate, user: CurrentUser, db: DbSession
) -> Feature:
    feature = await require_feature_access(db, feature_id, user, "member")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(feature, field, value)
    await db.commit()
    await db.refresh(feature)
    return feature


@router.delete("/api/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature(feature_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    feature = await require_feature_access(db, feature_id, user, "admin")
    await db.delete(feature)
    await db.commit()


# ------------------------------------------------------------------ 转正式 / 回退


async def _release_one(db, feature: Feature, cascade: bool) -> None:
    feature.stage = "released"
    feature.released_at = datetime.now(UTC)
    # 用例分期是派生值（COALESCE(stage_override, feature.stage)），所以正常情况下
    # 这里一行用例都不用写，功能转正后其下用例自动变成已发布。
    # 只有 cascade=true 时才清掉那些被显式钉在 in_iteration 的 override。
    if cascade:
        await db.execute(
            update(TestCase)
            .where(TestCase.feature_id == feature.id, TestCase.stage_override == "in_iteration")
            .values(stage_override=None)
        )


@router.post("/api/features/{feature_id}/release", response_model=FeatureOut)
async def release_feature(
    feature_id: uuid.UUID, body: ReleaseIn, user: CurrentUser, db: DbSession
) -> Feature:
    feature = await require_feature_access(db, feature_id, user, "admin")
    if feature.stage == "released":
        raise HTTPException(status.HTTP_409_CONFLICT, "该功能已是正式功能")
    await _release_one(db, feature, body.cascade)
    await db.commit()
    await db.refresh(feature)
    return feature


@router.post("/api/features/{feature_id}/reopen", response_model=FeatureOut)
async def reopen_feature(
    feature_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> Feature:
    feature = await require_feature_access(db, feature_id, user, "admin")
    if feature.stage == "in_iteration":
        raise HTTPException(status.HTTP_409_CONFLICT, "该功能已处于迭代中")
    # 回退不碰 stage_override：用户显式钉选的用例保持原样
    feature.stage = "in_iteration"
    feature.released_at = None
    await db.commit()
    await db.refresh(feature)
    return feature


@router.post("/api/features/bulk-release")
async def bulk_release(
    body: BulkIds, user: CurrentUser, db: DbSession, cascade: bool = False
) -> dict[str, list[str]]:
    released: list[str] = []
    skipped: list[str] = []
    for feature_id in body.ids:
        feature = await require_feature_access(db, feature_id, user, "admin")
        if feature.stage == "released":
            skipped.append(str(feature_id))
            continue
        await _release_one(db, feature, cascade)
        released.append(str(feature_id))
    await db.commit()
    return {"released": released, "skipped": skipped}


# ------------------------------------------------------------------ 用例数汇总


@router.get("/api/projects/{project_id}/features/case-counts")
async def feature_case_counts(
    project_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> dict[str, int]:
    """功能列表页要显示每个功能下挂了多少用例，一次查完避免 N+1。"""
    await require_project_access(db, project_id, user)
    stmt = (
        select(TestCase.feature_id, func.count(TestCase.id))
        .join(Feature, Feature.id == TestCase.feature_id)
        .where(Feature.project_id == project_id, TestCase.is_active.is_(True))
        .group_by(TestCase.feature_id)
    )
    return {str(fid): count for fid, count in (await db.execute(stmt)).all()}
