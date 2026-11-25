"""midscene 用例 YAML 的结构校验。

只校验两级：结构问题（一定跑不起来）+ 顶层未知键（几乎都是拼写错误，例如把 cases
写成 Cases，会导致整个文档被静默忽略）。用例内部和 steps 内部的键一律放行 —— midscene
随版本增加字段（实测已有 cases[].tags、cases[].retry），过严的校验会把合法用例挡在门外。
"""

from typing import Any

import yaml

KNOWN_TOP = {"cases", "beforeAll", "beforeEach", "afterEach", "tags", "variables"}
LIST_TOP = {"beforeAll", "beforeEach", "afterEach", "tags"}


def validate(text: str) -> tuple[list[str], int]:
    """返回 (错误列表, 解析出的 case 数)。错误列表为空表示通过。"""
    errors: list[str] = []
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f"（第 {mark.line + 1} 行，第 {mark.column + 1} 列）" if mark else ""
        return [f"YAML 语法错误{where}：{getattr(exc, 'problem', exc)}"], 0

    if doc is None:
        return ["文档为空"], 0
    if not isinstance(doc, dict):
        return ["顶层必须是映射（mapping），例如 cases: [...]"], 0

    cases: Any = doc.get("cases")
    if cases is None:
        return ["缺少顶层 cases 字段"], 0
    if not isinstance(cases, list):
        return ["cases 必须是列表"], 0
    if not cases:
        return ["cases 为空，至少需要一个用例"], 0

    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"cases[{index}] 必须是映射")
            continue
        # 拿到 name 后用名字指代，报错信息比下标好定位
        name = case.get("name")
        label = f"cases[{index}]「{name.strip()}」" if isinstance(name, str) and name.strip() else f"cases[{index}]"
        if not (isinstance(name, str) and name.strip()):
            errors.append(f"{label} 缺少非空的 name")

        steps = case.get("steps")
        if steps is None:
            errors.append(f"{label} 缺少 steps")
        elif not isinstance(steps, list):
            errors.append(f"{label} 的 steps 必须是列表")
        elif not steps:
            errors.append(f"{label} 的 steps 为空")
        else:
            # midscene 的解析器有一条硬规则：**一步只能有一个节点**（normalizeStep）。
            # 多写一个字段（例如把 cacheable 和 aiAct 写在同一层）会直接
            # WorkflowParseError，整份文档一个用例都跑不起来 —— 这里提前挡住。
            for step_index, step in enumerate(steps):
                where = f"{label} 的第 {step_index + 1} 步"
                if not isinstance(step, dict):
                    errors.append(f"{where}必须是映射，例如 aiAct: ...")
                    continue
                if len(step) != 1:
                    names = "、".join(str(key) for key in step)
                    errors.append(f"{where}只能有一个节点，现在有：{names}")
                    continue
                node, value = next(iter(step.items()))
                if node == "upload":
                    if not isinstance(value, dict):
                        errors.append(f"{where}的 upload 必须是对象，例如 upload: {{prompt: ..., file: KEY}}")
                    else:
                        if not isinstance(value.get("prompt"), str) or not value["prompt"].strip():
                            errors.append(f"{where}的 upload.prompt 不能为空")
                        files = value.get("files")
                        file_key = value.get("file")
                        if not file_key and not (
                            isinstance(files, list) and any(isinstance(item, str) and item.strip() for item in files)
                        ):
                            errors.append(f"{where}的 upload 必须指定 file 或 files")
                        if "options" in value:
                            errors.append(f"{where}的 upload 不支持 options")
                if node == "download":
                    if not isinstance(value, dict):
                        errors.append(
                            f"{where}的 download 必须是对象，例如 download: {{trigger: ...}}"
                        )
                    else:
                        trigger = value.get("trigger")
                        if not isinstance(trigger, str) or not trigger.strip():
                            errors.append(f"{where}的 download.trigger 不能为空")
                        if "options" in value:
                            errors.append(f"{where}的 download 不支持 options")
                if node == "aiAct" and isinstance(value, dict):
                    if "cacheable" in value:
                        errors.append(
                            f"{where}的 cacheable 要写在 aiAct.options 里，直接写在 aiAct 下会被忽略"
                        )
                    options = value.get("options")
                    if (
                        isinstance(options, dict)
                        and "cacheable" in options
                        and not isinstance(options["cacheable"], bool)
                    ):
                        errors.append(f"{where}的 options.cacheable 必须是 true 或 false")

    for key, value in doc.items():
        if key not in KNOWN_TOP:
            errors.append(f"未知的顶层字段 {key!r}")
        elif key in LIST_TOP and value is not None and not isinstance(value, list):
            errors.append(f"{key} 必须是列表")

    return errors, len(cases)


def structure_regression(old_text: str, new_text: str) -> str | None:
    """AI 修复时防止「只改前几行、后面被截掉」。

    修复可以替换内容、追加步骤，但不能减少用例数、某条用例的步骤数或生命周期步骤数。
    返回 None 表示结构没有缩水；否则返回给用户看的原因。
    """
    try:
        old = yaml.safe_load(old_text)
        new = yaml.safe_load(new_text)
    except yaml.YAMLError:
        return "修复后的内容不是合法 YAML"
    if not isinstance(old, dict) or not isinstance(new, dict):
        return "修复后的内容不是用例 YAML 文档"

    old_cases = [case for case in (old.get("cases") or []) if isinstance(case, dict)]
    new_cases = [case for case in (new.get("cases") or []) if isinstance(case, dict)]
    if len(new_cases) < len(old_cases):
        return f"用例数从 {len(old_cases)} 减少到 {len(new_cases)}"

    for index, (before, after) in enumerate(zip(old_cases, new_cases), 1):
        old_steps = len(before.get("steps") or [])
        new_steps = len(after.get("steps") or [])
        if new_steps < old_steps:
            return f"第 {index} 条用例的步骤从 {old_steps} 减少到 {new_steps}"

    for phase in ("beforeAll", "beforeEach", "afterEach", "afterAll"):
        old_steps = len(old.get(phase) or [])
        new_steps = len(new.get(phase) or [])
        if new_steps < old_steps:
            return f"{phase} 的步骤从 {old_steps} 减少到 {new_steps}"
    return None
