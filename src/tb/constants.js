/**
 * firmware 子插件的共享常量：归档字段、TB 看板、UA、字段归一。
 */

export const PROJECT_ID = '65a8da81950780b816d12bd9'; // 【研发部】CI/CD 发版流程

export const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

export const LINK_FIELDS = ['固件下载地址', 'OSS 线刷地址', 'OSS OTA地址', 'OSS 差分包地址'];

export const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
