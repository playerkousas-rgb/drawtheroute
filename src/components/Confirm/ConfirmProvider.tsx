import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConfirmCtx, type ConfirmFn, type ConfirmOptions } from './confirmShared';

/**
 * 防呆機制（guard）—— 對齊 2026 Scout System 全家標準（同 troop-portal ConfirmProvider）：
 * 所有「破壞性／不可逆」動作都必須先經用戶明確確認，才執行單一次操作。
 * 對話框列出即將變更的內容摘要（路點／路段數量等），
 * 用戶按「確認執行」後才真正執行；按「取消」或點背景＝完全不變。
 */

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    return new Promise<boolean>((resolve) => {
      setOpts(o);
      setResolver(() => resolve);
    });
  }, []);

  const close = useCallback(
    (val: boolean) => {
      setOpts(null);
      setResolver(null);
      resolver?.(val);
    },
    [resolver],
  );

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      <AnimatePresence>
        {opts && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center p-5"
            style={{
              zIndex: 2147483002,
              background: 'rgba(2,6,18,0.6)',
              backdropFilter: 'blur(4px)',
            }}
            role="dialog"
            aria-modal="true"
            aria-label={opts.title}
            onClick={() => close(false)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 8, opacity: 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full"
              style={{
                maxWidth: 420,
                background: 'rgba(8,14,28,0.97)',
                border: '1px solid rgba(148,163,184,0.22)',
                borderRadius: 16,
                boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                padding: '20px 22px',
                maxHeight: '84vh',
                overflow: 'auto',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span style={{ fontSize: 22 }}>{opts.danger ? '⚠️' : '✅'}</span>
                <h3
                  className="text-[15px] font-bold"
                  style={{ color: opts.danger ? '#fb7185' : '#34d399', margin: 0 }}
                >
                  {opts.title}
                </h3>
              </div>

              {opts.message && (
                <div
                  className="text-[12px] leading-relaxed"
                  style={{
                    margin: '14px 0',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px dashed rgba(148,163,184,0.3)',
                    background: 'rgba(15,23,42,0.55)',
                    color: '#cbd5e1',
                  }}
                >
                  {opts.message}
                </div>
              )}

              <p className="text-[11px]" style={{ margin: 0, color: 'rgba(148,163,184,0.75)' }}>
                請再次確認。按「{opts.confirmLabel || '確認執行'}」才會真正執行。
              </p>

              <div className="flex justify-end gap-2.5" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="text-[12px] font-medium px-4 py-2 rounded-lg transition-colors"
                  style={{
                    color: '#94a3b8',
                    border: '1px solid rgba(148,163,184,0.25)',
                    background: 'transparent',
                  }}
                >
                  {opts.cancelLabel || '取消'}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => close(true)}
                  className="text-[12px] font-bold px-4 py-2 rounded-lg transition-colors"
                  style={{
                    color: opts.danger ? '#fff' : '#022c22',
                    background: opts.danger ? '#e11d48' : '#34d399',
                    border: 'none',
                  }}
                >
                  {opts.confirmLabel || '確認執行'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmCtx.Provider>
  );
}
