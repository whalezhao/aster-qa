"""初始化数据：建一个管理员账号。

    uv run python seed.py [用户名] [密码]
"""

import asyncio
import sys

from sqlalchemy import select

from app.db import SessionLocal, engine
from app.migrate import run_migrations
from app.models import Team, TeamMember, User
from app.security import hash_password


async def main(username: str, password: str, team_name: str) -> None:
    await asyncio.to_thread(run_migrations)

    async with SessionLocal() as db:
        user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
        if user is None:
            user = User(username=username, display_name=username, password_hash=hash_password(password))
            db.add(user)
            await db.flush()
            print(f"已创建用户 {username}")
        else:
            user.password_hash = hash_password(password)
            print(f"用户 {username} 已存在，已重置密码")

        team = (await db.execute(select(Team).where(Team.name == team_name))).scalar_one_or_none()
        if team is None:
            team = Team(name=team_name, description="默认团队")
            db.add(team)
            await db.flush()
            print(f"已创建团队 {team_name}")

        member = (
            await db.execute(
                select(TeamMember).where(
                    TeamMember.team_id == team.id, TeamMember.user_id == user.id
                )
            )
        ).scalar_one_or_none()
        if member is None:
            db.add(TeamMember(team_id=team.id, user_id=user.id, role="owner"))
            print(f"已将 {username} 加入 {team_name} 作为 owner")

        await db.commit()

    await engine.dispose()


if __name__ == "__main__":
    args = sys.argv[1:]
    asyncio.run(
        main(
            args[0] if len(args) > 0 else "admin",
            args[1] if len(args) > 1 else "admin123",
            args[2] if len(args) > 2 else "默认团队",
        )
    )
