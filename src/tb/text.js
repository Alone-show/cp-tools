/**
 * TB 富文本/HTML -> 纯文本，截断，用于匹配与展示。
 *
 * 放在共享 TB 层：看板同步、实时检索、工单检索都要用，避免 tickets 反向依赖 firmware。
 */
export function plainText(input, max = 2000) {
  let s = String(input ?? '');
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > max) s = `${s.slice(0, max)}…`;
  return s;
}
