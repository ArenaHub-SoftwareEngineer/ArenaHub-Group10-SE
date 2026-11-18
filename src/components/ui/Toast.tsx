import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, AlertTriangle, Info, X } from './Icons';
interface Toast { id: string; message: string; type: 'success' | 'error' | 'info' }
interface ToastContextType { showToast: (message: string, type?: Toast['type']) => void }
const ToastContext = createContext<ToastContextType>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const reduced = useReducedMotion();
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = crypto.randomUUID();
    const clean = message.replace(/^Success!\s*/i, '').replace(/^[✓✔]\s*/, '').replace(/!+$/, '.');
    setToasts(current => [...current.slice(-2), { id, message: clean, type }]);
    const timer = setTimeout(() => { setToasts(current => current.filter(item => item.id !== id)); timers.current.delete(timer); }, type === 'error' ? 6500 : 4500);
    timers.current.add(timer);
  }, []);
  return <ToastContext.Provider value={{ showToast }}>{children}<div className="feedback-stack" role="region" aria-label="Notifications"><AnimatePresence initial={false}>{toasts.map(toast => <motion.div key={toast.id} className="feedback-note" data-kind={toast.type} role={toast.type === 'error' ? 'alert' : 'status'} initial={{ opacity: 0, y: reduced ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 4 }} transition={{ duration: reduced ? 0 : .18 }}><span className="feedback-note-icon">{toast.type === 'success' ? <Check size={17} /> : toast.type === 'error' ? <AlertTriangle size={17} /> : <Info size={17} />}</span><p>{toast.message}</p><button className="quiet-icon-button" aria-label="Dismiss notification" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}><X size={14} /></button></motion.div>)}</AnimatePresence></div></ToastContext.Provider>;
};
