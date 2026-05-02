import { useState, useCallback, createContext, useContext } from 'react';
import { Check, Copy, AlertCircle } from 'lucide-react';

type ToastType = 'success' | 'copy' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'copy') => {
    const id = toastId++;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-1.5 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className="toast-enter px-3 py-2 rounded-lg shadow-lg bg-[#3E2723] text-white text-[11px] flex items-center gap-2 min-w-[160px] justify-center"
          >
            {t.type === 'success' && <Check size={12} className="text-green-400" />}
            {t.type === 'copy' && <Copy size={12} className="text-white/70" />}
            {t.type === 'error' && <AlertCircle size={12} className="text-red-400" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
