import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 将时间值统一格式化为北京时间 YYYY-MM-DD HH:mm:ss
 * 支持 ISO 字符串、时间戳、Date 对象
 */
export function formatBeijingTime(value: string | number | Date | null | undefined): string {
  if (!value) return '-';
  const d = dayjs(value);
  if (!d.isValid()) return String(value);
  return d.tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
}
