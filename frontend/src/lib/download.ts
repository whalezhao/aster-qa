export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 测试用例 Excel 的文件名：去掉路径非法字符，带日期。 */
export function testCaseFileName(prefix: string, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || '测试用例';
  return `${prefix}_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`;
}