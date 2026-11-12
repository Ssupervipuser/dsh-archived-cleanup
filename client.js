window.__ModuleLoader__.load({
  id: 'dsh-archived-cleanup',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-archived-cleanup'
    const ROUTE = '/api/dsh-archived-cleanup'

    /** String dictionaries: the only shape `ctx.locale.register` accepts. */
    const dict = {
      zh: {
        nav: '已归档对话',
        title: '已归档对话',
        subtitle: '查看并彻底删除已归档的对话。删除会移除对话日志、投影缓存与工作区记录，无法恢复。',
        refresh: '刷新',
        loading: '正在读取…',
        empty: '没有已归档的对话。',
        selectAll: '全选',
        cancel: '取消',
        untitled: '未命名对话',
        missingLog: '日志缺失',
        skipped: '未能删除：',
        loadFailed: '读取失败',
        deleteFailed: '删除失败',
        selectFirst: '请先选择要删除的对话。',
        deleting: '正在删除…',
        notArchived: '该对话未归档',
        live: '该对话仍处于打开状态',
        unsafePath: '路径校验未通过',
      },
      en: {
        nav: 'Archived conversations',
        title: 'Archived conversations',
        subtitle: 'Review and permanently delete archived conversations. Deletion removes the conversation log, its cached projections, and its workspace entry. It cannot be undone.',
        refresh: 'Refresh',
        loading: 'Loading…',
        empty: 'No archived conversations.',
        selectAll: 'Select all',
        cancel: 'Cancel',
        untitled: 'Untitled conversation',
        missingLog: 'log missing',
        skipped: 'Not deleted:',
        loadFailed: 'Could not load',
        deleteFailed: 'Could not delete',
        selectFirst: 'Select the conversations to delete first.',
        deleting: 'Deleting…',
        notArchived: 'This conversation is not archived',
        live: 'This conversation is still open',
        unsafePath: 'Path check failed',
      },
    }

    /** Per-language phrases that need a parameter. */
    const phrase = {
      zh: {
        count: (n) => `共 ${n} 个`,
        total: (size) => `合计 ${size}`,
        selected: (n) => `已选 ${n} 个`,
        deleteSelected: (n) => `删除选中的 ${n} 个`,
        deleteAll: (n) => `全部删除（${n}）`,
        confirmSelected: (n) => `确认永久删除 ${n} 个？`,
        confirmAll: (n) => `确认永久删除全部 ${n} 个？`,
        done: (n, size) => `已删除 ${n} 个对话，释放 ${size}。`,
      },
      en: {
        count: (n) => `${n} total`,
        total: (size) => `${size} total`,
        selected: (n) => `${n} selected`,
        deleteSelected: (n) => `Delete ${n} selected`,
        deleteAll: (n) => `Delete all (${n})`,
        confirmSelected: (n) => `Permanently delete ${n}?`,
        confirmAll: (n) => `Permanently delete all ${n}?`,
        done: (n, size) => `Deleted ${n} conversation(s), freed ${size}.`,
      },
    }

    /** Skip-code to dictionary key. */
    const SKIP_KEY = { 'not-archived': 'notArchived', live: 'live', 'unsafe-path': 'unsafePath' }

    /**
     * Human-readable byte count.
     * @param bytes - raw byte count.
     * @returns the label.
     */
    function formatSize(bytes) {
      const value = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0
      if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
      if (value >= 1024) return `${Math.round(value / 1024)} KiB`
      return `${value} B`
    }

    /**
     * Calendar day of an epoch-ms value.
     * @param time - epoch ms, or null/undefined.
     * @returns the `YYYY-MM-DD` label, or an em dash.
     */
    function formatDay(time) {
      if (typeof time !== 'number' || !Number.isFinite(time)) return '—'
      const date = new Date(time)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    /**
     * One POST to this plugin's Host route.
     * @param method - `list` or `delete`.
     * @param body - JSON body.
     * @returns the `value` of a successful envelope.
     */
    async function callRoute(method, body) {
      const response = await fetch(`${ROUTE}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json().catch(() => null)
      if (payload === null) throw new Error(`HTTP ${response.status}`)
      if (payload.ok !== true) {
        const message = typeof payload.error?.message === 'string' ? payload.error.message : `HTTP ${response.status}`
        const error = new Error(message)
        error.code = payload.error?.code
        throw error
      }
      return payload.value
    }

    const STYLE = [
      '.dsh-ac-root{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}',
      '.dsh-ac-head{display:flex;align-items:flex-start;gap:12px}',
      '.dsh-ac-headText{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.dsh-ac-title{font-size:15px;font-weight:600}',
      '.dsh-ac-sub{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.dsh-ac-spacer{flex:1 1 auto}',
      '.dsh-ac-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dsh-ac-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}',
      '.dsh-ac-btn:disabled{opacity:.5;cursor:default}',
      '.dsh-ac-btn--danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-ac-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dsh-ac-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);',
      'font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-ac-list{max-height:420px;overflow:auto}',
      '.dsh-ac-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-ac-row:last-child{border-bottom:none}',
      '.dsh-ac-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-ac-rowText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}',
      '.dsh-ac-rowTitle{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-ac-rowMeta{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-ac-check{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);flex:0 0 auto}',
      '.dsh-ac-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-ac-note{font-size:12px;line-height:1.5}',
      '.dsh-ac-note--error{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-ac-note--ok{color:var(--dsw-alias-state-success-primary)}',
      '.dsh-ac-skip{margin:4px 0 0;padding-left:16px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-ac-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}',
    ].join('')

    /**
     * Build the settings page component, closed over the plugin context.
     * @param ctx - client plugin context.
     * @returns the React component.
     */
    function createSection(ctx) {
      /**
       * The archived-conversations settings page.
       * @returns the page element.
       */
      return function ArchivedCleanupSection() {
        const readLanguage = () => (ctx.locale.getLocale().active.toLowerCase().startsWith('zh') ? 'zh' : 'en')
        const [lang, setLang] = React.useState(readLanguage)
        const [items, setItems] = React.useState(null)
        const [totalBytes, setTotalBytes] = React.useState(0)
        const [selected, setSelected] = React.useState(() => new Set())
        const [pending, setPending] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [note, setNote] = React.useState(null)

        React.useEffect(() => {
          const off = ctx.locale.subscribe(() => setLang(readLanguage()))
          return off
        }, [])

        const t = dict[lang]
        const p = phrase[lang]

        const load = React.useCallback(async () => {
          setBusy(true)
          setNote(null)
          try {
            const value = await callRoute('list', {})
            setItems(Array.isArray(value?.items) ? value.items : [])
            setTotalBytes(typeof value?.totalBytes === 'number' ? value.totalBytes : 0)
            setSelected(new Set())
            setPending(null)
          } catch (error) {
            setNote({ kind: 'error', text: `${t.loadFailed}: ${error.message}` })
          } finally {
            setBusy(false)
          }
        }, [lang])

        React.useEffect(() => { void load() }, [])

        const toggle = (id) => {
          setPending(null)
          setSelected((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }

        const toggleAll = () => {
          setPending(null)
          setSelected((current) => {
            const all = items ?? []
            return current.size === all.length
              ? new Set()
              : new Set(all.map((item) => item.sessionId))
          })
        }

        const run = async (mode) => {
          const all = items ?? []
          const targets = mode === 'all' ? all.map((item) => item.sessionId) : [...selected]
          if (targets.length === 0) {
            setNote({ kind: 'error', text: t.selectFirst })
            return
          }
          if (pending !== mode) {
            setPending(mode)
            return
          }
          setBusy(true)
          setPending(null)
          try {
            const value = await callRoute('delete', mode === 'all' ? { all: true } : { sessionIds: targets })
            const skipped = (value?.results ?? []).filter((result) => result.deleted !== true)
            setNote({
              kind: skipped.length === 0 ? 'ok' : 'error',
              text: p.done(value?.deletedCount ?? 0, formatSize(value?.freedBytes ?? 0)),
              skipped: skipped.map((result) => `${result.sessionId}: ${t[SKIP_KEY[result.code]] ?? result.code}`),
            })
            try {
              const fresh = await callRoute('list', {})
              setItems(Array.isArray(fresh?.items) ? fresh.items : [])
              setTotalBytes(typeof fresh?.totalBytes === 'number' ? fresh.totalBytes : 0)
            } catch {
              setItems((current) => (current ?? []).filter((item) => !targets.includes(item.sessionId)))
            }
            setSelected(new Set())
          } catch (error) {
            setNote({ kind: 'error', text: `${t.deleteFailed}: ${error.message}` })
          } finally {
            setBusy(false)
          }
        }

        const rows = items ?? []
        const allSelected = rows.length > 0 && selected.size === rows.length

        const noteNode = note === null ? null : h('div', {
          className: `dsh-ac-note ${note.kind === 'error' ? 'dsh-ac-note--error' : 'dsh-ac-note--ok'}`,
        },
          h('div', null, note.text),
          Array.isArray(note.skipped) && note.skipped.length > 0
            ? h('div', null,
              h('div', null, t.skipped),
              h('ul', { className: 'dsh-ac-skip' }, note.skipped.map((line, index) => h('li', { key: String(index) }, line))),
            )
            : null,
        )

        const bar = h('div', { className: 'dsh-ac-bar' },
          items === null
            ? h('span', null, t.loading)
            : h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                className: 'dsh-ac-check',
                checked: allSelected,
                onChange: toggleAll,
                disabled: busy || rows.length === 0,
              }),
              h('span', null, t.selectAll),
            ),
          items === null ? null : h('span', null, p.count(rows.length)),
          items === null ? null : h('span', null, p.total(formatSize(totalBytes))),
          selected.size > 0 ? h('span', null, p.selected(selected.size)) : null,
        )

        const body = items === null
          ? h('div', { className: 'dsh-ac-empty' }, t.loading)
          : rows.length === 0
            ? h('div', { className: 'dsh-ac-empty' }, t.empty)
            : h('div', { className: 'dsh-ac-list' }, rows.map((item) => h('div', {
              key: item.sessionId,
              className: 'dsh-ac-row',
            },
              h('input', {
                type: 'checkbox',
                className: 'dsh-ac-check',
                checked: selected.has(item.sessionId),
                onChange: () => toggle(item.sessionId),
                disabled: busy,
              }),
              h('div', { className: 'dsh-ac-rowText' },
                h('div', { className: 'dsh-ac-rowTitle', title: item.title ?? item.sessionId },
                  item.title ?? t.untitled,
                ),
                h('div', { className: 'dsh-ac-rowMeta' },
                  [
                    formatDay(item.updatedAt ?? item.createdAt),
                    formatSize(item.sizeBytes),
                    item.cwd ?? null,
                    item.missing === true ? t.missingLog : null,
                    item.sessionId,
                  ].filter((part) => part !== null).join(' · '),
                ),
              ),
            )))

        const foot = h('div', { className: 'dsh-ac-foot' },
          h('button', {
            type: 'button',
            className: pending === 'selected' ? 'dsh-ac-btn dsh-ac-btn--danger' : 'dsh-ac-btn',
            onClick: () => { void run('selected') },
            disabled: busy || selected.size === 0,
          }, pending === 'selected' ? p.confirmSelected(selected.size) : p.deleteSelected(selected.size)),
          h('button', {
            type: 'button',
            className: pending === 'all' ? 'dsh-ac-btn dsh-ac-btn--danger' : 'dsh-ac-btn',
            onClick: () => { void run('all') },
            disabled: busy || rows.length === 0,
          }, pending === 'all' ? p.confirmAll(rows.length) : p.deleteAll(rows.length)),
          pending === null ? null : h('button', {
            type: 'button',
            className: 'dsh-ac-btn',
            onClick: () => setPending(null),
            disabled: busy,
          }, t.cancel),
          h('div', { className: 'dsh-ac-spacer' }),
          busy ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t.deleting) : null,
        )

        return h('div', { className: 'dsh-ac-root' },
          h('style', { key: 'style' }, STYLE),
          h('div', { key: 'head', className: 'dsh-ac-head' },
            h('div', { className: 'dsh-ac-headText' },
              h('div', { className: 'dsh-ac-title' }, t.title),
              h('div', { className: 'dsh-ac-sub' }, t.subtitle),
            ),
            h('div', { className: 'dsh-ac-spacer' }),
            h('button', {
              type: 'button',
              className: 'dsh-ac-btn',
              onClick: () => { void load() },
              disabled: busy,
            }, t.refresh),
          ),
          noteNode,
          h('div', { key: 'card', className: 'dsh-ac-card' }, bar, body, foot),
        )
      }
    }

    /**
     * Draw the settings navigation glyph for this section.
     * @param owner - owner props carrying the requested size.
     * @returns the icon element.
     */
    function SectionIcon(owner) {
      const size = owner !== null && typeof owner === 'object' && typeof owner.size === 'number' ? owner.size : 16
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M2 4.5h12M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M3.5 4.5l.7 8a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.5 7.2v4M9.5 7.2v4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
      )
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        const label = () => dict[ctx.locale.getLocale().active.toLowerCase().startsWith('zh') ? 'zh' : 'en'].nav
        ctx.effect(() => ctx.locale.register(NS, dict), 'dsh-archived-cleanup: dictionaries')
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'archived-cleanup',
          order: 92,
          label,
        }, createSection(ctx))), 'dsh-archived-cleanup: settings section')
        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'archived-cleanup',
        }, SectionIcon)), 'dsh-archived-cleanup: settings icon')
      },
    }
  },
})
