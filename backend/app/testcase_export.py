"""把 YAML 展开成客户可读的测试用例表，并导出为 Excel。"""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .ai_case import test_cases_of

HEADERS = [
    "系统",
    "功能",
    "用例集",
    "用例名称",
    "序号",
    "阶段",
    "测试步骤",
    "预期结果 / 判断逻辑",
    "备注",
]
PHASE_LABELS = {
    "precondition": "前置",
    "action": "操作",
    "wait": "等待",
    "assert": "断言",
    "cleanup": "清理",
}
COLUMN_WIDTHS = [18, 24, 28, 30, 8, 8, 60, 50, 36]


def rows_from_yaml(
    yaml_text: str,
    *,
    system: str = "",
    feature: str = "",
    case_set: str = "",
) -> list[dict]:
    rows: list[dict] = []
    for doc in test_cases_of(yaml_text):
        for seq, row in enumerate(doc["rows"], 1):
            rows.append(
                {
                    "system": system,
                    "feature": feature,
                    "case_set": case_set,
                    "case_name": doc["name"],
                    "seq": seq,
                    **row,
                }
            )
    return rows


def build_test_case_workbook(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "测试用例"
    ws.append(HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="DCE9F5")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row in rows:
        ws.append(
            [
                row.get("system") or "",
                row.get("feature") or "",
                row.get("case_set") or "",
                row.get("case_name") or "",
                row.get("seq") or "",
                PHASE_LABELS.get(row.get("phase") or "", row.get("phase") or ""),
                row.get("action") or "",
                row.get("expected") or "",
                row.get("note") or "",
            ]
        )

    for index, width in enumerate(COLUMN_WIDTHS, 1):
        ws.column_dimensions[get_column_letter(index)].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:I{max(ws.max_row, 1)}"

    out = BytesIO()
    wb.save(out)
    return out.getvalue()