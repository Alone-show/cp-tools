/**
 * cp-tools 的浏览器半侧：在「插件」页的组合包详情里编辑 BPMS 账号配置。
 *
 * 手写浏览器 bundle（与 wechat-worklog 相同格式，不经 tsdown 构建）：
 *   window.__ModuleLoader__.load({ id, factory(require) { ... } })
 * 只用平台模块表里的 react 与 @deepseek-ai/dsh-client-ui-primitives，用 React.createElement 代替 JSX。
 *
 * 数据面：宿主注册了 GET/POST /api/cp-tools/bpms/config。
 * GET 返回值 + revision + 密码是否已配置；POST 带 revision 与密码动作。
 * 密码永远不会下发到浏览器。
 */
window.__ModuleLoader__.load({
  id: '@local/cp-tools',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const ui = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    const NS = 'settings.cp-tools-bpms';
    const ROUTE = 'api/cp-tools/bpms/config';

    const zh = {
      title: 'BPMS 账号配置',
      description: '这里填的账号用于 /bpms 登录 BPMS（CPSales）。保存后下一次工具调用生效；密码保存后不会回显。',
      configPath: '配置文件',
      activePath: '当前生效配置',
      loading: '正在读取配置…',
      retry: '重试',
      save: '保存',
      saving: '保存中…',
      saveFailed: '保存失败',
      discard: '放弃修改',
      readOnly: '文件不可写',
      saved: '已保存',
      conflict: '配置文件已被外部修改，保存被拒绝。请重新载入后再编辑。',
      reload: '重新载入',
      missingNotice: '配置文件尚不存在；保存后会创建。',
      overriddenNotice: '当前生效的是另一份配置（环境变量或插件目录），这里保存不会立即生效。',
      baseUrl: '服务地址',
      baseUrlHint: '一般不用改：https://bpms.cpuniverse.cn',
      username: '用户名',
      usernameHint: 'BPMS 登录页的账号。',
      password: '密码',
      passwordHint: '已保存的密码不会回显；留空表示保持不变。',
      passwordKeep: '留空＝保持现有密码',
      passwordEmpty: '输入 BPMS 密码',
      tenant: '租户名称',
      tenantHint: '登录页顶部显示的租户名，例如「从平」。',
      timeout: '超时（秒）',
      timeoutHint: '单次请求超时，建议 20。',
      configured: '已配置',
      notConfigured: '未配置',
      clearPassword: '清除已保存的密码',
      required: '必填',
      invalidTimeout: '超时需在 3~300 之间',
      requestFailed: '请求失败',
      authFailed: '没有权限访问配置接口（请重新登录 DSH）',
      forbidden: '没有权限',
      invalidField: '字段不合法：{field}',
    };

    const en = {
      title: 'BPMS account',
      description: 'Credentials used by /bpms to sign in to BPMS (CPSales). Applied on the next tool call; saved passwords are never shown again.',
      configPath: 'Config file',
      activePath: 'Active config',
      loading: 'Loading…',
      retry: 'Retry',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'Save failed',
      discard: 'Discard',
      readOnly: 'File is read-only',
      saved: 'Saved',
      conflict: 'The config file changed elsewhere; reload before saving.',
      reload: 'Reload',
      missingNotice: 'Config file does not exist yet; it will be created on save.',
      overriddenNotice: 'Another config is active (environment or plugin folder); saving here will not take effect immediately.',
      baseUrl: 'Base URL',
      baseUrlHint: 'Usually unchanged: https://bpms.cpuniverse.cn',
      username: 'Username',
      usernameHint: 'The BPMS sign-in account.',
      password: 'Password',
      passwordHint: 'Stored passwords are not shown; leave blank to keep the current one.',
      passwordKeep: 'Leave blank to keep the current password',
      passwordEmpty: 'Enter the BPMS password',
      tenant: 'Tenant',
      tenantHint: 'Tenant name shown on the sign-in page, e.g. 从平.',
      timeout: 'Timeout (s)',
      timeoutHint: 'Per-request timeout, 20 is fine.',
      configured: 'Configured',
      notConfigured: 'Not configured',
      clearPassword: 'Clear saved password',
      required: 'Required',
      invalidTimeout: 'Timeout must be 3~300',
      requestFailed: 'Request failed',
      authFailed: 'Not authorized to access the config endpoint',
      forbidden: 'Forbidden',
      invalidField: 'Invalid field: {field}',
    };

    const CSS = `
.cp-bpms-page { display: grid; gap: 12px; padding: 4px 0 8px; }
.cp-bpms-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.cp-bpms-desc { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.cp-bpms-path { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.cp-bpms-path code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.cp-bpms-notice { margin: 0; padding: 8px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.cp-bpms-saved { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 12px; line-height: 18px; }
.cp-bpms-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; display: grid; gap: 6px; }
.cp-bpms-field { display: grid; gap: 6px; }
.cp-bpms-label { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.cp-bpms-input { box-sizing: border-box; width: 100%; padding: 8px 10px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); font: inherit; font-size: 13px; line-height: 20px; }
.cp-bpms-input:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.cp-bpms-input:disabled { opacity: .6; }
.cp-bpms-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.cp-bpms-invalid { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.cp-bpms-check { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.cp-bpms-check input { width: 14px; height: 14px; accent-color: var(--dsw-alias-brand-primary); }
.cp-bpms-button { font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-brand-primary); background: none; border: 0; padding: 0; cursor: pointer; justify-self: start; }
.cp-bpms-button:hover { text-decoration: underline; }
.cp-bpms-form { display: grid; gap: 12px; }
.cp-bpms-fields { display: grid; gap: 12px; }
.cp-bpms-actions { display: flex; align-items: center; gap: 12px; }
.cp-bpms-primary { font: inherit; font-size: 12px; line-height: 18px; padding: 5px 14px; border-radius: var(--dsw-radius-md); border: 1px solid var(--dsw-alias-brand-primary); color: #fff; background: var(--dsw-alias-brand-primary); cursor: pointer; }
.cp-bpms-primary:disabled { opacity: .5; cursor: default; }
.cp-bpms-state { color: var(--dsw-alias-label-tertiary); font-weight: normal; }
`;

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      const tagId = '@local/cp-tools/bpms-config.css';
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/cp-tools';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    async function request(method, body) {
      const headers = { accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(ROUTE, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = text === '' ? {} : JSON.parse(text);
      } catch {
        payload = {};
      }
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = payload?.error?.code;
        error.field = payload?.error?.field;
        throw error;
      }
      return payload;
    }

    function draftFrom(view) {
      const values = view?.values ?? {};
      return {
        base_url: typeof values.base_url === 'string' ? values.base_url : '',
        username: typeof values.username === 'string' ? values.username : '',
        tenant_name: typeof values.tenant_name === 'string' ? values.tenant_name : '',
        timeout: String(values.timeout_seconds ?? 20),
      };
    }

    function valuesFromDraft(draft) {
      return {
        base_url: draft.base_url.trim(),
        username: draft.username.trim(),
        tenant_name: draft.tenant_name.trim(),
        timeout_seconds: Number(draft.timeout),
      };
    }

    function draftValid(draft) {
      if (!draft) return false;
      if (!draft.base_url.trim() || !draft.username.trim() || !draft.tenant_name.trim()) return false;
      const timeout = Number(draft.timeout);
      return Number.isFinite(timeout) && timeout >= 3 && timeout <= 300;
    }

    function sameDraft(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function errorText(err, t) {
      if (!err) return t('requestFailed');
      if (err.status === 401) return t('authFailed');
      if (err.status === 403) return t('forbidden');
      if (err.code === 'invalid') return t('invalidField').replace('{field}', err.field || '');
      if (err.code === 'stale' || err.status === 409) return t('conflict');
      return err.message || t('requestFailed');
    }

    function TextField(props) {
      const { t, id, labelKey, hintKey, value, onChange, disabled, invalid, type, inputMode } = props;
      return h('div', { className: 'cp-bpms-field' }, [
        h('label', { key: 'label', className: 'cp-bpms-label', htmlFor: id }, t(labelKey)),
        h('input', {
          key: 'input',
          id,
          className: 'cp-bpms-input',
          type: type || 'text',
          inputMode,
          value,
          disabled,
          onChange: (event) => onChange(event.target.value),
        }),
        invalid ? h('p', { key: 'invalid', className: 'cp-bpms-invalid' }, t('required')) : null,
        h('p', { key: 'hint', className: 'cp-bpms-hint' }, t(hintKey)),
      ]);
    }

    function ConfigPage(props) {
      const { t } = props;
      const [phase, setPhase] = React.useState('loading');
      const [view, setView] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const [baseline, setBaseline] = React.useState(null);
      const [passwordText, setPasswordText] = React.useState('');
      const [clearPassword, setClearPassword] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [conflict, setConflict] = React.useState(false);
      const [saved, setSaved] = React.useState(false);

      const load = React.useCallback(async () => {
        setPhase('loading');
        setError(null);
        setConflict(false);
        try {
          const next = await request('GET');
          const nextDraft = draftFrom(next);
          setView(next);
          setDraft(nextDraft);
          setBaseline(nextDraft);
          setPasswordText('');
          setClearPassword(false);
          setSaved(false);
          setPhase('ready');
        } catch (err) {
          setError(err);
          setPhase('error');
        }
      }, []);

      React.useEffect(() => {
        ensureStyles();
        void load();
      }, [load]);

      const edit = (key, value) => {
        setSaved(false);
        setDraft((prev) => ({ ...prev, [key]: value }));
      };
      const editPassword = (value) => {
        setSaved(false);
        setPasswordText(value);
      };
      const toggleClearPassword = (checked) => {
        setSaved(false);
        setClearPassword(checked);
        if (checked) setPasswordText('');
      };
      const discard = () => {
        setDraft(baseline);
        setPasswordText('');
        setClearPassword(false);
        setSaved(false);
      };

      const save = async () => {
        if (!draft) return;
        setSaving(true);
        setError(null);
        setConflict(false);
        try {
          const password = clearPassword
            ? { action: 'clear' }
            : passwordText !== ''
              ? { action: 'set', value: passwordText }
              : { action: 'keep' };
          const next = await request('POST', {
            revision: view?.revision,
            values: valuesFromDraft(draft),
            password,
          });
          const nextDraft = draftFrom(next);
          setView(next);
          setDraft(nextDraft);
          setBaseline(nextDraft);
          setPasswordText('');
          setClearPassword(false);
          setSaved(true);
        } catch (err) {
          if (err.code === 'stale' || err.status === 409) setConflict(true);
          else setError(err);
        } finally {
          setSaving(false);
        }
      };

      if (phase === 'loading') {
        return h('div', { className: 'cp-bpms-page' }, [h('p', { key: 'loading', className: 'cp-bpms-desc' }, t('loading'))]);
      }
      if (phase === 'error' || !draft || !view) {
        return h('div', { className: 'cp-bpms-page' }, [
          h('p', { key: 'error', className: 'cp-bpms-error' }, errorText(error, t)),
          h(
            'button',
            { key: 'retry', type: 'button', className: 'cp-bpms-button', onClick: () => void load() },
            t('retry'),
          ),
        ]);
      }

      const disabled = saving || !view.writable;
      const dirty =
        !sameDraft(draft, baseline) || passwordText !== '' || clearPassword;
      const secretSet = Boolean(view.secrets?.password?.set);
      const timeoutInvalid = !draftValid(draft);

      const fields = [
        h(TextField, {
          key: 'base_url',
          t,
          id: 'cp-bpms-base-url',
          labelKey: 'baseUrl',
          hintKey: 'baseUrlHint',
          value: draft.base_url,
          onChange: (value) => edit('base_url', value),
          disabled,
          invalid: draft.base_url.trim() === '',
        }),
        h(TextField, {
          key: 'username',
          t,
          id: 'cp-bpms-username',
          labelKey: 'username',
          hintKey: 'usernameHint',
          value: draft.username,
          onChange: (value) => edit('username', value),
          disabled,
          invalid: draft.username.trim() === '',
        }),
        h('div', { key: 'password', className: 'cp-bpms-field' }, [
          h('label', { key: 'label', className: 'cp-bpms-label', htmlFor: 'cp-bpms-password' }, [
            t('password'),
            ' ',
            h(
              'span',
              { key: 'state', className: 'cp-bpms-state' },
              secretSet ? t('configured') : t('notConfigured'),
            ),
          ]),
          h('input', {
            key: 'input',
            id: 'cp-bpms-password',
            className: 'cp-bpms-input',
            type: 'password',
            autoComplete: 'new-password',
            placeholder: secretSet ? t('passwordKeep') : t('passwordEmpty'),
            value: passwordText,
            disabled: disabled || clearPassword,
            onChange: (event) => editPassword(event.target.value),
          }),
          h('p', { key: 'hint', className: 'cp-bpms-hint' }, t('passwordHint')),
          secretSet
            ? h('label', { key: 'clear', className: 'cp-bpms-check' }, [
                h('input', {
                  key: 'input',
                  type: 'checkbox',
                  checked: clearPassword,
                  disabled,
                  onChange: (event) => toggleClearPassword(event.target.checked),
                }),
                h('span', { key: 'text' }, t('clearPassword')),
              ])
            : null,
        ]),
        h(TextField, {
          key: 'tenant_name',
          t,
          id: 'cp-bpms-tenant',
          labelKey: 'tenant',
          hintKey: 'tenantHint',
          value: draft.tenant_name,
          onChange: (value) => edit('tenant_name', value),
          disabled,
          invalid: draft.tenant_name.trim() === '',
        }),
        h(TextField, {
          key: 'timeout',
          t,
          id: 'cp-bpms-timeout',
          labelKey: 'timeout',
          hintKey: 'timeoutHint',
          value: draft.timeout,
          onChange: (value) => edit('timeout', value),
          disabled,
          invalid: timeoutInvalid,
          type: 'number',
          inputMode: 'numeric',
        }),
      ];

      return h('div', { className: 'cp-bpms-page' }, [
        h('h3', { key: 'title', className: 'cp-bpms-title' }, t('title')),
        h('p', { key: 'desc', className: 'cp-bpms-desc' }, t('description')),
        h('p', { key: 'path', className: 'cp-bpms-path' }, `${t('configPath')}: `, h('code', {}, view.path)),
        view.overridden
          ? h('p', { key: 'overridden', className: 'cp-bpms-notice', role: 'status' }, [
              t('overriddenNotice'),
              view.activePath ? ` (${t('activePath')}: ${view.activePath})` : '',
            ])
          : null,
        view.exists ? null : h('p', { key: 'missing', className: 'cp-bpms-notice', role: 'status' }, t('missingNotice')),
        saved ? h('p', { key: 'saved', className: 'cp-bpms-saved', role: 'status' }, t('saved')) : null,
        conflict
          ? h('div', { key: 'conflict', className: 'cp-bpms-error', role: 'alert' }, [
              h('p', { key: 'message' }, t('conflict')),
              h(
                'button',
                { key: 'reload', type: 'button', className: 'cp-bpms-button', onClick: () => void load() },
                t('reload'),
              ),
            ])
          : null,
        error && !conflict
          ? h('p', { key: 'error', className: 'cp-bpms-error', role: 'alert' }, errorText(error, t))
          : null,
        h('div', { key: 'form', className: 'cp-bpms-form' }, [
          h('div', { key: 'fields', className: 'cp-bpms-fields' }, fields),
          h('div', { key: 'actions', className: 'cp-bpms-actions' }, [
            h(
              ui.Button,
              {
                key: 'save',
                variant: 'primary',
                disabled: saving || !dirty || timeoutInvalid || !view.writable,
                onClick: () => void save(),
              },
              saving ? t('saving') : t('save'),
            ),
            h(
              ui.Button,
              { key: 'discard', variant: 'ghost', disabled: saving || !dirty, onClick: discard },
              t('discard'),
            ),
            view.writable
              ? null
              : h('span', { key: 'readonly', className: 'cp-bpms-hint' }, t('readOnly')),
            error ? h('span', { key: 'failed', className: 'cp-bpms-invalid' }, t('saveFailed')) : null,
          ]),
        ]),
      ]);
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cp-tools: BPMS Web 配置字典');
      ctx.effect(
        () =>
          ctx.slots.inject('plugins.bundle.config', () =>
            ctx.slots.register(
              { name: 'plugins.bundle.config', key: '@local/cp-tools', locale: NS },
              ConfigPage,
            ),
          ),
        'cp-tools: BPMS Web 配置页',
      );
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
