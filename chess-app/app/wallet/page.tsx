'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, ArrowDownLeft, ArrowUpRight, Clock, CheckCircle,
  XCircle, AlertCircle, Shield, TrendingUp, RefreshCw, Eye, EyeOff, Loader2
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

type Modal = null | 'deposit' | 'withdraw' | 'verify';
type TxFilter = 'all' | 'deposit' | 'withdraw' | 'game';

const DEPOSIT_AMOUNTS = [50000, 100000, 200000, 500000, 1000000, 2000000];

const BANKS = ['BCA', 'BNI', 'BRI', 'Mandiri', 'CIMB', 'Danamon', 'Permata'];

interface WalletBalance { balance: number; locked: number; }
interface Transaction {
  id: string; type: string; amount: number; status: string;
  description: string; created_at: string; midtrans_order_id?: string;
}

// Load Midtrans Snap.js dynamically
function loadSnapJS(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if ((window as unknown as Record<string, unknown>).snap) return resolve();
    const script = document.createElement('script');
    script.src = process.env.NODE_ENV === 'production'
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js';
    script.setAttribute('data-client-key', process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY || '');
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

export default function WalletPage() {
  const { user, token, updateUser } = useAppStore();
  const [modal, setModal] = useState<Modal>(null);
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBank, setWithdrawBank] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [withdrawName, setWithdrawName] = useState('');
  const [showBalance, setShowBalance] = useState(true);
  const [txFilter, setTxFilter] = useState<TxFilter>('all');

  const [balance, setBalance] = useState<WalletBalance>({ balance: user?.balance || 0, locked: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchBalance = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.wallet.balance(token);
      setBalance(data);
      updateUser({ balance: data.balance });
    } catch { /* ignore */ }
  }, [token, updateUser]);

  const fetchTransactions = useCallback(async () => {
    if (!token) return;
    setLoadingTx(true);
    try {
      const data = await api.wallet.transactions(token, 50);
      setTransactions(data.transactions || []);
    } catch { /* ignore */ }
    finally { setLoadingTx(false); }
  }, [token]);

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
    loadSnapJS();
  }, [fetchBalance, fetchTransactions]);

  const handleDeposit = async () => {
    const amount = depositAmount || parseInt(customAmount);
    if (!amount || amount < 10000) {
      setError('Minimum deposit Rp 10.000');
      return;
    }
    if (!token) return;
    setDepositing(true);
    setError('');
    try {
      const { snapToken } = await api.wallet.deposit(token, amount);

      const snap = (window as unknown as Record<string, unknown>).snap as {
        pay: (token: string, opts: Record<string, unknown>) => void;
      };
      if (!snap) throw new Error('Snap not loaded');

      snap.pay(snapToken, {
        onSuccess: () => {
          setModal(null);
          setSuccess('Deposit berhasil! Saldo akan diperbarui.');
          setTimeout(() => { fetchBalance(); fetchTransactions(); setSuccess(''); }, 3000);
        },
        onPending: () => {
          setModal(null);
          setSuccess('Menunggu pembayaran. Saldo akan diperbarui otomatis.');
          setTimeout(() => { fetchTransactions(); setSuccess(''); }, 5000);
        },
        onError: () => {
          setError('Pembayaran gagal. Silakan coba lagi.');
        },
        onClose: () => {
          setModal(null);
          fetchTransactions();
        },
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Deposit gagal');
    } finally {
      setDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseInt(withdrawAmount);
    if (!amount || amount < 50000) { setError('Minimum withdraw Rp 50.000'); return; }
    if (!withdrawBank) { setError('Pilih bank tujuan'); return; }
    if (!withdrawAccount) { setError('Masukkan nomor rekening'); return; }
    if (!withdrawName) { setError('Masukkan nama pemilik rekening'); return; }
    if (!token) return;

    setWithdrawing(true);
    setError('');
    try {
      const data = await api.wallet.withdraw(token, {
        amount,
        bankCode: withdrawBank,
        accountNumber: withdrawAccount,
        accountName: withdrawName,
      });
      setModal(null);
      setSuccess(`Permintaan withdraw dikirim. Estimasi: ${data.estimatedTime}. Order ID: ${data.orderId}`);
      setTimeout(() => { fetchBalance(); fetchTransactions(); setSuccess(''); }, 5000);
      setWithdrawAmount(''); setWithdrawBank(''); setWithdrawAccount(''); setWithdrawName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Withdraw gagal');
    } finally {
      setWithdrawing(false);
    }
  };

  const filteredTx = transactions.filter(tx => {
    if (txFilter === 'all') return true;
    if (txFilter === 'deposit') return tx.type === 'deposit';
    if (txFilter === 'withdraw') return tx.type === 'withdraw';
    if (txFilter === 'game') return tx.type.startsWith('game') || tx.type === 'tournament-prize';
    return true;
  });

  const totalDeposits = transactions.filter(t => t.type === 'deposit' && t.status === 'completed').reduce((s, t) => s + t.amount, 0);
  const totalWins = transactions.filter(t => t.type === 'game-win' && t.status === 'completed').reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = transactions.filter(t => t.type === 'withdraw' && t.status === 'completed').reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Wallet</h1>
          <p className="text-[var(--text-muted)] mt-1">Kelola dana Anda dengan aman via Midtrans</p>
        </motion.div>

        {/* Success / Error banners */}
        <AnimatePresence>
          {success && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-400">{success}</p>
            </motion.div>
          )}
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
              <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300 text-lg leading-none">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Balance card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 via-blue-700 to-indigo-800 p-6 shadow-2xl shadow-blue-900/40">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 -translate-y-20 translate-x-20" />
          <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full bg-white/5 translate-y-12 -translate-x-8" />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
                  <span className="text-xl">♔</span>
                </div>
                <div>
                  <div className="text-xs text-white/60">Chess Arena</div>
                  <div className="text-sm font-semibold text-white">{user?.username}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {user?.verified ? (
                  <div className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 text-xs px-3 py-1.5 rounded-full border border-emerald-400/30 font-medium">
                    <Shield className="w-3.5 h-3.5" /> Verified
                  </div>
                ) : (
                  <button onClick={() => setModal('verify')}
                    className="flex items-center gap-1.5 bg-yellow-500/20 text-yellow-300 text-xs px-3 py-1.5 rounded-full border border-yellow-400/30 font-medium hover:bg-yellow-500/30 transition-colors">
                    <AlertCircle className="w-3.5 h-3.5" /> Verifikasi
                  </button>
                )}
              </div>
            </div>

            <div className="mb-6">
              <div className="text-xs text-white/60 mb-1 flex items-center gap-2">
                Total Saldo
                <button onClick={() => setShowBalance(!showBalance)} className="hover:text-white/80 transition-colors">
                  {showBalance ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-4xl font-black text-white">
                {showBalance ? `Rp ${balance.balance.toLocaleString('id-ID')}` : '••• ••••••'}
              </div>
              {balance.locked > 0 && (
                <div className="text-xs text-white/50 mt-1">
                  Rp {balance.locked.toLocaleString('id-ID')} terkunci di pertandingan aktif
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setModal('deposit'); setError(''); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-semibold text-white text-sm transition-colors backdrop-blur-sm border border-white/10">
                <ArrowDownLeft className="w-4 h-4" /> Deposit
              </button>
              <button onClick={() => { setModal('withdraw'); setError(''); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl font-semibold text-white text-sm transition-colors backdrop-blur-sm border border-white/10">
                <ArrowUpRight className="w-4 h-4" /> Tarik Dana
              </button>
              <button onClick={() => { fetchBalance(); fetchTransactions(); }}
                className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-xl text-white transition-colors border border-white/10">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Deposit', value: `Rp ${(totalDeposits/1000).toFixed(0)}K`, icon: ArrowDownLeft, color: 'sky' },
            { label: 'Kemenangan Game', value: `Rp ${(totalWins/1000).toFixed(0)}K`, icon: TrendingUp, color: 'emerald' },
            { label: 'Ditarik', value: `Rp ${(totalWithdrawals/1000).toFixed(0)}K`, icon: ArrowUpRight, color: 'orange' },
          ].map(s => (
            <div key={s.label} className="card p-4 rounded-2xl text-center">
              <div className={`w-9 h-9 rounded-xl mx-auto mb-2 flex items-center justify-center
                ${s.color === 'sky' ? 'bg-sky-500/10' : s.color === 'emerald' ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}>
                <s.icon className={`w-4 h-4 ${s.color === 'sky' ? 'text-sky-400' : s.color === 'emerald' ? 'text-emerald-400' : 'text-orange-400'}`} />
              </div>
              <div className="text-sm font-bold text-[var(--text-primary)]">{s.value}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Transactions */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h3 className="font-bold text-[var(--text-primary)]">Riwayat Transaksi</h3>
            <div className="flex gap-1">
              {(['all','deposit','withdraw','game'] as const).map(f => (
                <button key={f} onClick={() => setTxFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${txFilter === f ? 'bg-sky-500/20 text-sky-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
                  {f === 'all' ? 'Semua' : f === 'deposit' ? 'Deposit' : f === 'withdraw' ? 'Tarik' : 'Game'}
                </button>
              ))}
            </div>
          </div>
          {loadingTx ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
            </div>
          ) : filteredTx.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Belum ada transaksi</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {filteredTx.map((tx) => (
                <div key={tx.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-colors">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                    ${tx.type === 'deposit' ? 'bg-sky-500/10' : tx.type === 'withdraw' ? 'bg-orange-500/10' : tx.amount > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                    {tx.type === 'deposit' ? <ArrowDownLeft className="w-4 h-4 text-sky-400" /> :
                     tx.type === 'withdraw' ? <ArrowUpRight className="w-4 h-4 text-orange-400" /> :
                     tx.amount > 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> :
                     <DollarSign className="w-4 h-4 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--text-primary)] truncate">{tx.description}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {new Date(tx.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-sm font-bold ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount > 0 ? '+' : ''}Rp {Math.abs(tx.amount).toLocaleString('id-ID')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1
                      ${tx.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : tx.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
                      {tx.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : tx.status === 'pending' ? <Clock className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {tx.status === 'completed' ? 'Sukses' : tx.status === 'pending' ? 'Pending' : 'Gagal'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {/* Deposit Modal */}
        {modal === 'deposit' && (
          <ModalOverlay onClose={() => setModal(null)}>
            <div className="bg-[var(--bg-card)] rounded-3xl w-full max-w-md overflow-hidden border border-[var(--border)] shadow-2xl">
              <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">Deposit Dana</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Powered by Midtrans — GoPay, QRIS, VA Bank</p>
                </div>
                <button onClick={() => setModal(null)} className="w-8 h-8 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">✕</button>
              </div>
              <div className="p-6 space-y-4">
                {error && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-3 block">Pilih Nominal</label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {DEPOSIT_AMOUNTS.map(a => (
                      <button key={a} onClick={() => { setDepositAmount(a); setCustomAmount(''); }}
                        className={`py-2.5 rounded-xl text-sm font-semibold transition-all
                          ${depositAmount === a ? 'bg-sky-500 text-white' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border)]'}`}>
                        Rp {a >= 1000000 ? `${a/1000000}M` : `${a/1000}K`}
                      </button>
                    ))}
                  </div>
                  <input type="number" placeholder="Atau masukkan nominal lain (min Rp 10.000)"
                    value={customAmount} onChange={e => { setCustomAmount(e.target.value); setDepositAmount(null); }}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-sky-500 transition-colors" />
                </div>
                <div className="flex items-center gap-2 p-3 bg-sky-500/10 rounded-xl border border-sky-500/20">
                  <Shield className="w-4 h-4 text-sky-400 flex-shrink-0" />
                  <p className="text-xs text-sky-400">Pembayaran aman melalui Midtrans. Mendukung GoPay, ShopeePay, QRIS, BCA/BNI/BRI VA, Kartu Kredit.</p>
                </div>
                <button onClick={handleDeposit}
                  disabled={depositing || (!depositAmount && !customAmount)}
                  className="w-full py-3 bg-sky-500 text-white rounded-xl font-semibold disabled:opacity-40 hover:bg-sky-600 transition-colors flex items-center justify-center gap-2">
                  {depositing ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</> : `Bayar Rp ${(depositAmount || parseInt(customAmount) || 0).toLocaleString('id-ID')}`}
                </button>
              </div>
            </div>
          </ModalOverlay>
        )}

        {/* Withdraw Modal */}
        {modal === 'withdraw' && (
          <ModalOverlay onClose={() => setModal(null)}>
            <div className="bg-[var(--bg-card)] rounded-3xl w-full max-w-md overflow-hidden border border-[var(--border)] shadow-2xl">
              <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">Tarik Dana</h2>
                <button onClick={() => setModal(null)} className="w-8 h-8 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">✕</button>
              </div>
              <div className="p-6 space-y-4">
                {error && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
                <div className="bg-[var(--bg-hover)] rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-[var(--text-muted)]">Saldo Tersedia</span>
                  <span className="font-bold text-emerald-400">Rp {(balance.balance - balance.locked).toLocaleString('id-ID')}</span>
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Nominal</label>
                  <input type="number" placeholder="Minimum Rp 50.000" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-sky-500 transition-colors" />
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Bank Tujuan</label>
                  <select value={withdrawBank} onChange={e => setWithdrawBank(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-sky-500 transition-colors">
                    <option value="">Pilih Bank</option>
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Nomor Rekening</label>
                  <input type="text" placeholder="Masukkan nomor rekening" value={withdrawAccount} onChange={e => setWithdrawAccount(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-sky-500 transition-colors" />
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Nama Pemilik Rekening</label>
                  <input type="text" placeholder="Sesuai nama di buku tabungan" value={withdrawName} onChange={e => setWithdrawName(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-sky-500 transition-colors" />
                </div>
                {withdrawAmount && parseInt(withdrawAmount) >= 50000 && (
                  <div className="bg-[var(--bg-hover)] rounded-xl p-3 text-xs space-y-1">
                    <div className="flex justify-between text-[var(--text-muted)]">
                      <span>Nominal</span><span>Rp {parseInt(withdrawAmount).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between text-[var(--text-muted)]">
                      <span>Biaya platform (4%)</span><span>- Rp {Math.round(parseInt(withdrawAmount) * 0.04).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between font-bold text-[var(--text-primary)] pt-1 border-t border-[var(--border)]">
                      <span>Diterima</span><span className="text-emerald-400">Rp {Math.round(parseInt(withdrawAmount) * 0.96).toLocaleString('id-ID')}</span>
                    </div>
                  </div>
                )}
                <div className="bg-yellow-500/10 rounded-xl p-3 border border-yellow-500/20 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Proses 1-3 hari kerja. Biaya platform 4%. Minimum Rp 50.000.</p>
                </div>
                <button onClick={handleWithdraw}
                  disabled={withdrawing || !withdrawAmount || !withdrawBank || !withdrawAccount || !withdrawName}
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                  {withdrawing ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</> : 'Ajukan Penarikan'}
                </button>
              </div>
            </div>
          </ModalOverlay>
        )}

        {/* Verify Modal */}
        {modal === 'verify' && (
          <ModalOverlay onClose={() => setModal(null)}>
            <div className="bg-[var(--bg-card)] rounded-3xl w-full max-w-md overflow-hidden border border-[var(--border)] shadow-2xl">
              <div className="p-6 text-center">
                <Shield className="w-12 h-12 text-sky-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Verifikasi Akun</h2>
                <p className="text-sm text-[var(--text-muted)] mb-6">Verifikasi membuka limit withdraw lebih tinggi dan akses pertandingan uang nyata.</p>
                <div className="space-y-3 text-left mb-6">
                  {['Upload KTP / Paspor', 'Foto selfie dengan KTP', 'Verifikasi nomor HP', 'Kode OTP'].map((step, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-hover)]">
                      <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center font-bold">{i + 1}</div>
                      <span className="text-sm text-[var(--text-primary)]">{step}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => setModal(null)} className="w-full py-3 bg-sky-500 text-white rounded-xl font-semibold hover:bg-sky-600 transition-colors">Mulai Verifikasi</button>
              </div>
            </div>
          </ModalOverlay>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-md">
        {children}
      </motion.div>
    </motion.div>
  );
}
