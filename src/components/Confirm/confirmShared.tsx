import { createContext, useContext, type ReactNode } from 'react';

/**
 * 防呆機制（guard）共用部分 —— 對齊 2026 Scout System 全家標準。
 * 類型／hook／摘要 helper 獨立成檔，避免 react-refresh 混合匯出。
 */

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export const ConfirmCtx = createContext<{ confirm: ConfirmFn }>({
  confirm: async () => false,
});

export function useConfirm() {
  return useContext(ConfirmCtx);
}

/** 建立確認對話框內的「欄位：值」摘要清單（空值自動略過）。 */
export function kv(rows: Array<[string, ReactNode]>, emptyText = '（留空）'): ReactNode {
  const filled = rows.filter(([, v]) => v !== '' && v !== undefined && v !== null);
  if (filled.length === 0) return <span style={{ color: 'rgba(148,163,184,0.7)' }}>{emptyText}</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {filled.map(([k, v], i) => (
        <li key={i} style={{ margin: '3px 0' }}>
          <span style={{ color: 'rgba(148,163,184,0.85)' }}>{k}：</span>
          {v}
        </li>
      ))}
    </ul>
  );
}
