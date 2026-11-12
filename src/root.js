/**
 * 包根入口：只作为 Web 客户端的载体。
 *
 * DSH 的 client-modules 只扫描「模块名正好等于包名」的插件行来发现 `dsh.client`；
 * `@local/cp-tools/docs` 这类子路径行会被 exactPackageSpecifier 判为不确定而跳过。
 * 所以这里放一个空插件，由 cordis.patch.yml 以 `name: '@local/cp-tools'` 载入，
 * 让浏览器侧的 `./client`（BPMS 配置页）能被发现。宿主侧逻辑都在各子插件里。
 */
export const name = 'cp-tools-web';
export const inject = [];

export function apply() {
  /* 不注册任何东西：本行只负责让包根进入 client-modules 的扫描范围。 */
}
