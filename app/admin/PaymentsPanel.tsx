import { useEffect, useState } from 'react';
import { adminApi, PAYMENT_METHODS, type Payment } from '../shared-ui/api.js';
import type { Session } from './shared.js';

/** Local 'YYYY-MM-DD' default for the paid-date field (the sitter can change it). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One booking's payment ledger: existing payments (each deletable — deleting the record is the
 * only correction mechanism) plus the record-payment form. Shared by BookingsSection (rows) and
 * EarningsSection (outstanding table); `onChanged` lets each parent re-fetch its own payload.
 */
export function PaymentsPanel({
  session,
  bookingId,
  onChanged,
  handleError,
}: {
  session: Session;
  bookingId: string;
  onChanged: () => void | Promise<void>;
  handleError: (e: unknown) => void;
}) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [paidDate, setPaidDate] = useState(todayStr);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const canSubmit = Number.isInteger(amountNum) && amountNum >= 1 && paidDate.trim() !== '';

  const load = () =>
    adminApi.payments
      .list(session.slug, session.token, bookingId)
      .then(({ payments: list }) => list);

  useEffect(() => {
    let active = true;
    load()
      .then((list) => active && setPayments(list))
      .catch((e) => active && handleError(e));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, session]);

  const record = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.payments.record(session.slug, session.token, bookingId, {
        amount: Number(amount),
        method,
        paidDate,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAmount('');
      setNote('');
      setPaidDate(todayStr());
      setPayments(await load());
      await onChanged();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (paymentId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.payments.remove(session.slug, session.token, bookingId, paymentId);
      setPayments(await load());
      await onChanged();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-payments">
      {payments === null ? (
        <p>Loading…</p>
      ) : payments.length === 0 ? (
        <p className="pb-hint">No payments recorded yet.</p>
      ) : (
        <ul>
          {payments.map((p) => (
            <li key={p.id}>
              <span>
                ${p.amount} · {p.method} · {p.paidDate}
                {p.note ? ` — ${p.note}` : ''}
              </span>
              <button disabled={busy} onClick={() => void remove(p.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pb-row">
        <label className="pb-inline">
          Amount ($)
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="pb-inline">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="pb-inline">
          Date
          <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </label>
        <label className="pb-inline">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button disabled={busy || !canSubmit} onClick={() => void record()}>
          Record payment
        </button>
      </div>
    </div>
  );
}
