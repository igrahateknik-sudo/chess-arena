'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign, ArrowDownLeft, ArrowUpRight, Clock, CheckCircle,
  XCircle, AlertCircle, Shield, TrendingUp, RefreshCw, Eye, EyeOff,
  Loader2, Copy, Upload, CheckCheck, Building2, CreditCard
} from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import BankLogo, { BankSelector } from '@/components/ui/BankLogo';
import { useAppStore } from '@/lib/store';
import { api, ApiError } from '@/lib/api';

type Modal = null | 'deposit' | 'withdraw';
type DepositStep = 'choose' | 'details' | 'proof' | 'done';
type TxFilter = 'all' | 'deposit' | 'withdraw' | 'game';

const PRESET_AMOUNTS = [25000, 50000, 100000, 250000, 500000];
const BANKS = ['BCA', 'BNI', 'BRI', 'Mandiri', 'CIMB', 'Danamon', 'Permata', 'BSI', 'BTN', 'OCBC'];

interface WalletBalance { balance: number; locked: number; }
interface Transaction {
  id: string; type: string; amount: number; status: string;
  description: string; created_at: string;
}
interface ManualDeposit {
  id: string; amount: number; uniqueCode: number; transferAmount: number;
  bank?: { name: string; account_number: string; account_holder: string };
  status: string; proof_url?: string; created_at: string;
}
interface ManualWithdrawal {
  id: string; amount: number; bank_name: string; account_number: string;
  account_name: string; status: string; admin_note?: string; created_at: string;
}

function formatIDR(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',    cls: 'bg-yellow-500/10 text-yellow-400' },
  approved:  { label: 'Disetujui', cls: 'bg-amber-500/10 text-amber-400' },
  completed: { label: 'Selesai',   cls: 'bg-emerald-500/10 text-emerald-400' },
  rejected:  { label: 'Ditolak',   cls: 'bg-red-500/10 text-red-400' },
  success:   { label: 'Sukses',    cls: 'bg-emerald-500/10 text-emerald-400' },
};

export default function WalletPage() {
  const { user, token, updateUser } = useAppStore();
  const [modal, setModal] = useState<Modal>(null);

  // Deposit state
  const [depositStep, setDepositStep] = useState<DepositStep>('choose');
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  const [customAmountStr, setCustomAmountStr] = useState('');
  const [currentDeposit, setCurrentDeposit] = useState<ManualDeposit | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBank, setWithdrawBank] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [withdrawName, setWithdrawName] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const [showBalance, setShowBalance] = useState(true);
  const [txFilter, setTxFilter] = useState<TxFilter>('all');
  const [balance, setBalance] = useState<WalletBalance>({ balance: user?.balance || 0, locked: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [myDeposits, setMyDeposits] = useState<ManualDeposit[]>([]);
  const [myWithdrawals, setMyWithdrawals] = useState<ManualWithdrawal[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [bankInfo, setBankInfo] = useState<{ name: string; account_number: string; account_holder: string } | null>(null);
  const [loadError, setLoadError] = useState('');

  const fetchBalance = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.wallet.balance(token);
      setBalance(data);
      updateUser({ balance: data.balance });
    } catch {
      setLoadError('Gagal memuat saldo wallet.');
    }
  }, [token, updateUser]);

  const fetchTransactions = useCallback(async () => {
    if (!token) return;
    setLoadingTx(true);
    setLoadError('');
    try {
      const [txData, depData, wdData] = await Promise.all([
        api.wallet.transactions(token, 50),
        api.wallet.myManualDeposits(token),
        api.wallet.myManualWithdrawals(token),
      ]);
      setTransactions(txData.transactions || []);
      setMyDeposits(depData.deposits || []);
      setMyWithdrawals(wdData.withdrawals || []);
    } catch {
      setLoadError('Gagal memuat riwayat transaksi.');
    }
    finally { setLoadingTx(false); }
  }, [token]);

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
    api.wallet.bankInfo()
      .then((d: { bank: typeof bankInfo }) => setBankInfo(d.bank))
      .catch(() => setLoadError('Informasi rekening deposit tidak tersedia.'));
  }, [fetchBalance, fetchTransactions]);

  function openDeposit() {
    setModal('deposit');
    setDepositStep('choose');
    setDepositAmount(null);
    setCustomAmountStr('');
    setCurrentDeposit(null);
    setProofFile(null);
    setProofPreview('');
    setError('');
  }

  function openWithdraw() {
    setModal('withdraw');
    setWithdrawAmount('');
    setWithdrawBank('');
    setWithdrawAccount('');
    setWithdrawName('');
    setError('');
  }

  const handleCreateDeposit = async () => {
    if (!depositAmount || !token) return;
    setDepositing(true);
    setError('');
    try {
      const data = await api.wallet.manualDeposit(token, depositAmount);
      setCurrentDeposit({ ...data.deposit, bank: bankInfo || undefined });
      setDepositStep('details');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat deposit');
    } finally {
      setDepositing(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
  };

  const handleUploadProof = async () => {
    if (!proofFile || !currentDeposit || !token) return;
    setUploadingProof(true);
    setError('');
    try {
      await api.wallet.uploadDepositProof(token, currentDeposit.id, proofFile);
      setDepositStep('done');
      fetchTransactions();
      fetchBalance();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload gagal');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseInt(withdrawAmount);
    if (!amount || amount < 50000) { setError('Minimum penarikan Rp 50.000'); return; }
    if (!withdrawBank) { setError('Pilih bank tujuan'); return; }
    if (!withdrawAccount) { setError('Masukkan nomor rekening'); return; }
    if (!withdrawName) { setError('Masukkan nama pemilik rekening'); return; }
    if (!token) return;
    setWithdrawing(true);
    setError('');
    try {
      await api.wallet.manualWithdraw(token, {
        amount, bankName: withdrawBank, accountNumber: withdrawAccount, accountName: withdrawName,
      });
      setModal(null);
      setSuccess('Permintaan penarikan berhasil dikirim. Admin akan memproses dalam 1×24 jam kerja.');
      setTimeout(() => { fetchBalance(); fetchTransactions(); setSuccess(''); }, 5000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengajukan penarikan');
    } finally {
      setWithdrawing(false);
    }
  };

  const filteredTx = transactions.filter(tx => {
    if (txFilter === 'all') return true;
    if (txFilter === 'deposit') return tx.type === 'deposit' || tx.type === 'refund';
    if (txFilter === 'withdraw') return tx.type === 'withdraw';
    if (txFilter === 'game') return tx.type.startsWith('game') || tx.type === 'tournament-prize';
    return true;
  });

  const totalDeposits = transactions.filter(t => t.type === 'deposit' && t.status === 'success').reduce((s, t) => s + t.amount, 0);
  const totalWins = transactions.filter(t => t.type === 'game-win').reduce((s, t) => s + t.amount, 0);
  const totalWithdrawn = transactions.filter(t => t.type === 'withdraw' && t.status === 'success').reduce((s, t) => s + Math.abs(t.amount), 0);

  const pendingDeposit = myDeposits.find(d => d.status === 'pending');

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Wallet</h1>
          <p className="text-[var(--text-muted)] mt-1">Deposit & tarik dana melalui transfer bank manual</p>
        </motion.div>

        {/* Banners */}
        <AnimatePresence>
          {loadError && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{loadError}</p>
            </motion.div>
          )}
          {success && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-400">{success}</p>
            </motion.div>
          )}
          {error && !modal && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
              <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Balance card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-600 via-yellow-700 to-orange-800 p-6 shadow-2xl shadow-amber-900/40">
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
              {user?.verified && (
                <div className="flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 text-xs px-3 py-1.5 rounded-full border border-emerald-400/30 font-medium">
                  <Shield className="w-3.5 h-3.5" /> Verified
                </div>
              )}
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
                <div className="text-xs text-white/50 mt-1">Rp {balance.locked.toLocaleString('id-ID')} terkunci di pertandingan aktif</div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={openDeposit}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl font-semibold text-white text-sm transition-colors backdrop-blur-sm border border-white/10">
                <ArrowDownLeft className="w-4 h-4" /> Deposit
              </button>
              <button onClick={openWithdraw}
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
            { label: 'Total Deposit', value: formatIDR(totalDeposits), icon: ArrowDownLeft, color: 'amber' },
            { label: 'Kemenangan', value: formatIDR(totalWins), icon: TrendingUp, color: 'emerald' },
            { label: 'Ditarik', value: formatIDR(totalWithdrawn), icon: ArrowUpRight, color: 'orange' },
          ].map(s => (
            <div key={s.label} className="card p-4 rounded-2xl text-center">
              <div className={`w-9 h-9 rounded-xl mx-auto mb-2 flex items-center justify-center
                ${s.color === 'amber' ? 'bg-amber-500/10' : s.color === 'emerald' ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}>
                <s.icon className={`w-4 h-4 ${s.color === 'amber' ? 'text-amber-400' : s.color === 'emerald' ? 'text-emerald-400' : 'text-orange-400'}`} />
              </div>
              <div className="text-sm font-bold text-[var(--text-primary)]">{s.value}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Pending deposit notice */}
        {pendingDeposit && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-400">Ada deposit pending</p>
                <p className="text-xs text-yellow-500/80">Transfer Rp {pendingDeposit.transferAmount?.toLocaleString('id-ID')} — menunggu konfirmasi admin</p>
              </div>
            </div>
            {!pendingDeposit.proof_url && (
              <button onClick={() => {
                setCurrentDeposit(pendingDeposit);
                setDepositStep('proof');
                setModal('deposit');
                setError('');
              }} className="text-xs bg-yellow-500/20 text-yellow-400 px-3 py-1.5 rounded-lg hover:bg-yellow-500/30 transition-colors font-medium">
                Upload Bukti
              </button>
            )}
          </motion.div>
        )}

        {/* Manual deposit history */}
        {myDeposits.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
            className="card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text-primary)]">Riwayat Deposit Manual</h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {myDeposits.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--text-primary)]">Transfer BCA — Rp {d.amount?.toLocaleString('id-ID')}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {new Date(d.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_LABEL[d.status]?.cls || 'bg-slate-500/10 text-slate-400'}`}>
                    {STATUS_LABEL[d.status]?.label || d.status}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Manual withdrawal history */}
        {myWithdrawals.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
            className="card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text-primary)]">Riwayat Penarikan</h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {myWithdrawals.slice(0, 5).map(w => (
                <div key={w.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <CreditCard className="w-4 h-4 text-orange-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--text-primary)]">{w.bank_name} {w.account_number}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      Rp {w.amount?.toLocaleString('id-ID')} · {new Date(w.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                      {w.admin_note && ` · ${w.admin_note}`}
                    </div>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_LABEL[w.status]?.cls || 'bg-slate-500/10 text-slate-400'}`}>
                    {STATUS_LABEL[w.status]?.label || w.status}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Transaction history */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="card rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h3 className="font-bold text-[var(--text-primary)]">Riwayat Transaksi</h3>
            <div className="flex gap-1">
              {(['all','deposit','withdraw','game'] as const).map(f => (
                <button key={f} onClick={() => setTxFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${txFilter === f ? 'bg-amber-500/20 text-amber-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
                  {f === 'all' ? 'Semua' : f === 'deposit' ? 'Deposit' : f === 'withdraw' ? 'Tarik' : 'Game'}
                </button>
              ))}
            </div>
          </div>
          {loadingTx ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
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
                    ${tx.type === 'deposit' ? 'bg-amber-500/10' : tx.type === 'withdraw' ? 'bg-orange-500/10' : tx.amount > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                    {tx.type === 'deposit' ? <ArrowDownLeft className="w-4 h-4 text-amber-400" /> :
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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${STATUS_LABEL[tx.status]?.cls || 'bg-slate-500/10 text-slate-400'}`}>
                      {tx.status === 'success' ? <CheckCircle className="w-3 h-3" /> : tx.status === 'pending' ? <Clock className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {STATUS_LABEL[tx.status]?.label || tx.status}
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
          <ModalOverlay onClose={() => { setModal(null); setError(''); }}>
            <div className="bg-[var(--bg-card)] rounded-3xl w-full max-w-md overflow-hidden border border-[var(--border)] shadow-2xl">
              <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">Deposit Dana</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Transfer bank ke rekening BCA</p>
                </div>
                <button onClick={() => { setModal(null); setError(''); }}
                  className="w-8 h-8 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">✕</button>
              </div>

              {/* Step indicator */}
              {depositStep !== 'done' && (
                <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--border)]">
                  {(['choose','details','proof'] as const).map((step, i) => (
                    <div key={step} className="flex items-center gap-2">
                      {i > 0 && <div className="flex-1 h-px w-8 bg-[var(--border)]" />}
                      <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center
                        ${depositStep === step ? 'bg-amber-500 text-white' :
                          (['choose','details','proof'].indexOf(depositStep) > i) ? 'bg-emerald-500 text-white' :
                          'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                        {(['choose','details','proof'].indexOf(depositStep) > i) ? <CheckCheck className="w-3 h-3" /> : i + 1}
                      </div>
                    </div>
                  ))}
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {depositStep === 'choose' ? 'Pilih nominal' : depositStep === 'details' ? 'Transfer' : 'Upload bukti'}
                  </span>
                </div>
              )}

              <div className="p-6">
                {error && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg mb-4">{error}</p>}

                {/* Step 1: choose amount */}
                {depositStep === 'choose' && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-[var(--text-primary)] mb-3 block">Pilih Nominal Deposit</label>
                      <div className="grid grid-cols-3 gap-2">
                        {PRESET_AMOUNTS.map(a => (
                          <button key={a} onClick={() => { setDepositAmount(a === depositAmount && !customAmountStr ? null : a); setCustomAmountStr(''); }}
                            className={`py-3 rounded-xl text-sm font-semibold transition-all border
                              ${depositAmount === a && !customAmountStr
                                ? 'bg-amber-500 text-white border-amber-400'
                                : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border)] border-transparent'}`}>
                            {formatIDR(a)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted)] mb-1.5 block">Atau masukkan nominal lain (min. Rp 25.000)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">Rp</span>
                        <input
                          type="number"
                          min={25000}
                          step={1000}
                          placeholder="0"
                          value={customAmountStr}
                          onChange={e => {
                            const val = e.target.value;
                            setCustomAmountStr(val);
                            const num = parseInt(val);
                            setDepositAmount(num > 0 ? num : null);
                          }}
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-amber-500 transition-colors"
                        />
                      </div>
                      {customAmountStr && parseInt(customAmountStr) < 25000 && (
                        <p className="text-xs text-red-400 mt-1">Minimum deposit Rp 25.000</p>
                      )}
                    </div>
                    <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-xs text-amber-400">
                      Kode unik 3 digit akan ditambahkan ke nominal transfer untuk identifikasi pembayaran kamu.
                    </div>
                    <button onClick={handleCreateDeposit} disabled={!depositAmount || (!!customAmountStr && parseInt(customAmountStr) < 25000) || depositing}
                      className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold disabled:opacity-40 hover:bg-amber-600 transition-colors flex items-center justify-center gap-2">
                      {depositing ? <><Loader2 className="w-4 h-4 animate-spin" />Membuat...</> : `Lanjut — ${depositAmount ? formatIDR(depositAmount) : 'Pilih nominal'}`}
                    </button>
                  </div>
                )}

                {/* Step 2: transfer details */}
                {depositStep === 'details' && currentDeposit && (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-br from-amber-600/20 to-yellow-600/10 border border-amber-500/20 rounded-2xl p-5 text-center">
                      <p className="text-xs text-[var(--text-muted)] mb-1">Transfer tepat sebesar</p>
                      <p className="text-3xl font-black text-white">Rp {currentDeposit.transferAmount?.toLocaleString('id-ID')}</p>
                      <p className="text-xs text-amber-400 mt-1">Nominal Rp {currentDeposit.amount?.toLocaleString('id-ID')} + kode unik <strong>{String(currentDeposit.uniqueCode).padStart(3,'0')}</strong></p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-[var(--bg-hover)] rounded-xl p-4">
                        <div>
                          <p className="text-xs text-[var(--text-muted)] mb-1.5">Bank Tujuan Transfer</p>
                          <BankLogo bank="BCA" size="lg" />
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[var(--text-muted)]">Verified</p>
                          <p className="text-xs font-semibold text-emerald-400">✓ Rekening Aktif</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between bg-[var(--bg-hover)] rounded-xl p-4">
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">Nomor Rekening</p>
                          <p className="font-bold text-[var(--text-primary)] font-mono tracking-widest">0811 3297 96</p>
                        </div>
                        <button onClick={() => handleCopy('0811329796')}
                          className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-lg transition-colors">
                          {copied ? <><CheckCheck className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Salin</>}
                        </button>
                      </div>
                      <div className="flex items-center justify-between bg-[var(--bg-hover)] rounded-xl p-4">
                        <div>
                          <p className="text-xs text-[var(--text-muted)]">Atas Nama</p>
                          <p className="font-bold text-[var(--text-primary)]">ALI FAHKRUDIN</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                      <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-500 dark:text-yellow-400">Transfer <strong>tepat</strong> Rp {currentDeposit.transferAmount?.toLocaleString('id-ID')} — termasuk kode unik. Nominal berbeda tidak bisa diverifikasi.</p>
                    </div>

                    <button onClick={() => setDepositStep('proof')}
                      className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors">
                      Sudah Transfer — Upload Bukti
                    </button>
                  </div>
                )}

                {/* Step 3: upload proof */}
                {depositStep === 'proof' && (
                  <div className="space-y-4">
                    <p className="text-sm text-[var(--text-muted)]">Upload foto atau screenshot bukti transfer kamu.</p>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors
                        ${proofPreview ? 'border-emerald-500/40' : 'border-[var(--border)] hover:border-amber-500/40'}`}>
                      {proofPreview ? (
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={proofPreview} alt="bukti" className="max-h-48 mx-auto rounded-xl object-contain" />
                          <div className="absolute -top-2 -right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                            <CheckCheck className="w-3.5 h-3.5 text-white" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 mx-auto mb-2 text-[var(--text-muted)]" />
                          <p className="text-sm text-[var(--text-muted)]">Klik untuk pilih file</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">JPG, PNG — maks 5MB</p>
                        </>
                      )}
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    </div>

                    <button onClick={handleUploadProof} disabled={!proofFile || uploadingProof}
                      className="w-full py-3 bg-emerald-500 text-white rounded-xl font-semibold disabled:opacity-40 hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2">
                      {uploadingProof ? <><Loader2 className="w-4 h-4 animate-spin" />Mengupload...</> : 'Kirim Bukti Transfer'}
                    </button>
                  </div>
                )}

                {/* Step 4: done */}
                {depositStep === 'done' && (
                  <div className="text-center py-4 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
                      <CheckCircle className="w-8 h-8 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[var(--text-primary)]">Bukti Terkirim!</h3>
                      <p className="text-sm text-[var(--text-muted)] mt-2">Admin akan memverifikasi transfer kamu dalam 1×24 jam kerja. Saldo akan otomatis ditambahkan setelah disetujui.</p>
                    </div>
                    <button onClick={() => { setModal(null); setError(''); }}
                      className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors">
                      Selesai
                    </button>
                  </div>
                )}
              </div>
            </div>
          </ModalOverlay>
        )}

        {/* Withdraw Modal */}
        {modal === 'withdraw' && (
          <ModalOverlay onClose={() => { setModal(null); setError(''); }}>
            <div className="bg-[var(--bg-card)] rounded-3xl w-full max-w-md overflow-hidden border border-[var(--border)] shadow-2xl">
              <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">Tarik Dana</h2>
                <button onClick={() => { setModal(null); setError(''); }}
                  className="w-8 h-8 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">✕</button>
              </div>
              <div className="p-6 space-y-4">
                {error && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

                <div className="bg-[var(--bg-hover)] rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-[var(--text-muted)]">Saldo Tersedia</span>
                  <span className="font-bold text-emerald-400">Rp {(balance.balance - balance.locked).toLocaleString('id-ID')}</span>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Nominal (min Rp 50.000)</label>
                  <input type="number" placeholder="Masukkan nominal" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-amber-500 transition-colors" />
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Bank Tujuan</label>
                  <BankSelector
                    banks={BANKS}
                    selected={withdrawBank}
                    onSelect={setWithdrawBank}
                  />
                  {withdrawBank && (
                    <p className="text-xs text-amber-400 mt-1.5 font-medium">✓ {withdrawBank} dipilih</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Nomor Rekening</label>
                  <input type="text" placeholder="Masukkan nomor rekening" value={withdrawAccount} onChange={e => setWithdrawAccount(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-amber-500 transition-colors" />
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] mb-2 block">Nama Pemilik Rekening</label>
                  <input type="text" placeholder="Sesuai nama di buku tabungan" value={withdrawName} onChange={e => setWithdrawName(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-amber-500 transition-colors" />
                </div>

                <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                  <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Admin akan memproses dalam 1×24 jam kerja. Saldo langsung dikurangi saat pengajuan.</p>
                </div>

                <button onClick={handleWithdraw}
                  disabled={withdrawing || !withdrawAmount || !withdrawBank || !withdrawAccount || !withdrawName}
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                  {withdrawing ? <><Loader2 className="w-4 h-4 animate-spin" />Memproses...</> : `Ajukan Penarikan ${withdrawAmount ? `— Rp ${parseInt(withdrawAmount).toLocaleString('id-ID')}` : ''}`}
                </button>
                {(!withdrawAmount || !withdrawBank || !withdrawAccount || !withdrawName) && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Lengkapi nominal, bank, nomor rekening, dan nama pemilik untuk mengaktifkan tombol.
                  </p>
                )}
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
        className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        {children}
      </motion.div>
    </motion.div>
  );
}
