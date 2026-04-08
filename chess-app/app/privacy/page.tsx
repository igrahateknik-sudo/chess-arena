import Link from 'next/link';
import { Lock } from 'lucide-react';

export const metadata = {
  title: 'Kebijakan Privasi — Chess Arena',
  description: 'Kebijakan Privasi Chess Arena — platform kompetisi catur skill-based Indonesia.',
  robots: 'index, follow',
};

const EFFECTIVE_DATE = '3 April 2026';
const COMPANY       = 'Chess Arena';
const CONTACT_EMAIL = 'igrahateknik@gmail.com';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-white/10">{title}</h2>
      <div className="space-y-3 text-zinc-300 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="font-semibold text-white mb-2">{title}</h3>
      {children}
    </div>
  );
}

function DataTable({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Data</th>
            <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Tujuan</th>
            <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Dasar Hukum</th>
            <th className="text-left py-2 text-zinc-400 font-medium">Retensi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(([data, purpose, basis, retention], i) => (
            <tr key={i}>
              <td className="py-2 pr-4 font-medium text-white">{data}</td>
              <td className="py-2 pr-4">{purpose}</td>
              <td className="py-2 pr-4 text-zinc-400">{basis}</td>
              <td className="py-2 text-zinc-400">{retention}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-secondary)]">

      {/* Header */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)]">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-amber-400 font-bold text-lg">
            ♔ Chess<span className="text-white">Arena</span>
          </Link>
          <span className="text-[var(--text-muted)]">›</span>
          <span className="text-[var(--text-muted)] text-sm">Kebijakan Privasi</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">

        {/* Title */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Lock size={20} className="text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">Kebijakan Privasi</h1>
          </div>
          <p className="text-zinc-400 text-sm">
            Berlaku sejak: <strong className="text-zinc-200">{EFFECTIVE_DATE}</strong>
          </p>
          <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
            <strong>Chess Arena</strong> adalah platform <strong>kompetisi catur berbasis skill</strong> — bukan platform perjudian.
            Biaya entri turnamen adalah biaya partisipasi kompetisi, dan hadiah diberikan berdasarkan performa bermain catur.
          </div>
          <p className="mt-3 text-sm">
            {COMPANY} berkomitmen melindungi privasi pengguna. Dokumen ini menjelaskan data apa yang
            kami kumpulkan, bagaimana kami menggunakannya, dan hak-hak kamu atas datamu.
          </p>
        </div>

        {/* TOC */}
        <div className="mb-10 p-5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <h2 className="font-semibold text-[var(--text-primary)] mb-3 text-sm uppercase tracking-wide">Daftar Isi</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">
            {[
              ['#controller', '1. Pengelola Data'],
              ['#collected', '2. Data yang Dikumpulkan'],
              ['#anticheat-data', '3. Data Anti-Cheat'],
              ['#use', '4. Penggunaan Data'],
              ['#sharing', '5. Berbagi Data'],
              ['#retention', '6. Retensi Data'],
              ['#security', '7. Keamanan Data'],
              ['#rights', '8. Hak Pengguna'],
              ['#cookies', '9. Cookie & Teknologi Serupa'],
              ['#children', '10. Data Anak-Anak'],
              ['#changes', '11. Perubahan Kebijakan'],
              ['#contact', '12. Kontak & DPO'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="text-amber-400 hover:text-amber-300 transition-colors py-0.5">{label}</a>
            ))}
          </div>
        </div>

        <Section id="controller" title="1. Pengelola Data">
          <p>
            {COMPANY} bertindak sebagai Pengendali Data (Data Controller) untuk semua data yang dikumpulkan
            melalui platform ini, sebagaimana didefinisikan dalam peraturan perlindungan data yang berlaku
            di Indonesia (UU PDP No. 27 Tahun 2022).
          </p>
          <p>Kontak Pengelola Data: <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-400">{CONTACT_EMAIL}</a></p>
        </Section>

        <Section id="collected" title="2. Data yang Dikumpulkan">
          <Sub title="2.1 Data yang Kamu Berikan">
            <ul className="list-disc pl-5 space-y-1">
              <li>Nama pengguna, alamat email, dan kata sandi (disimpan sebagai hash bcrypt)</li>
              <li>Negara dan preferensi profil</li>
              <li>Informasi rekening bank untuk penarikan dana (tidak disimpan di server kami — diproses langsung oleh Midtrans)</li>
            </ul>
          </Sub>
          <Sub title="2.2 Data yang Dikumpulkan Otomatis">
            <ul className="list-disc pl-5 space-y-1">
              <li>Riwayat permainan dan gerakan (termasuk timestamp server dan FEN board state)</li>
              <li>Log koneksi socket (waktu connect/disconnect)</li>
              <li>Riwayat ELO dan statistik permainan</li>
              <li>Hash perangkat untuk deteksi multi-akun (lihat Bagian 3)</li>
              <li>Log keamanan (rate limit, token validation events)</li>
            </ul>
          </Sub>
          <DataTable rows={[
            ['Email & Password', 'Autentikasi', 'Kontrak', '5 tahun setelah tutup akun'],
            ['Riwayat Permainan', 'Gameplay, anti-cheat', 'Kepentingan Sah', '3 tahun'],
            ['Log Keuangan', 'Audit, kepatuhan', 'Kewajiban Hukum', '10 tahun'],
            ['Device Hash', 'Anti-cheat, keamanan', 'Kepentingan Sah', '2 tahun'],
            ['Log Keamanan', 'Investigasi penipuan', 'Kepentingan Sah', '1 tahun'],
          ]} />
        </Section>

        <Section id="anticheat-data" title="3. Data Anti-Cheat">
          <p>
            Untuk menjaga integritas kompetisi skill-based, kami mengumpulkan dan memproses
            data berikut khusus untuk keperluan anti-cheat:
          </p>
          <Sub title="3.1 Device Fingerprinting">
            <p>
              Kami mengumpulkan alamat IP dan User-Agent browser kamu <strong>hanya dalam bentuk hash
              SHA-256 satu arah</strong>. Raw IP address tidak pernah disimpan dalam database kami.
              Hash ini digunakan untuk mendeteksi akun ganda yang beroperasi dari perangkat yang sama.
            </p>
            <div className="mt-2 p-3 bg-zinc-800 rounded-lg text-xs font-mono text-zinc-400">
              fingerprint_hash = SHA256(ip_address + "|" + user_agent)
              <br/>ip_hash = SHA256(ip_address)  ← tidak dapat di-reverse
            </div>
          </Sub>
          <Sub title="3.2 Move Audit Log">
            <p>
              Setiap gerakan yang diterima server dicatat secara immutable (tidak dapat diubah)
              dengan timestamp server, FEN position, dan waktu yang digunakan. Log ini digunakan
              untuk investigasi anti-cheat dan penyelesaian sengketa.
            </p>
          </Sub>
          <Sub title="3.3 Engine Analysis">
            <p>
              Gerakan-gerakan dari game yang sudah selesai dapat dianalisis dengan engine chess
              Stockfish untuk mendeteksi pola yang mengindikasikan penggunaan asisten AI.
              Analisis ini dilakukan di server kami dan tidak melibatkan pihak ketiga.
            </p>
          </Sub>
          <Sub title="3.4 Hak Terkait Data Anti-Cheat">
            <p>
              Kamu berhak meminta penjelasan mengapa akunmu ditandai berdasarkan data anti-cheat.
              Namun, untuk alasan integritas sistem, kami tidak mengungkapkan detail spesifik
              metode deteksi yang dapat digunakan untuk menghindari sistem.
            </p>
          </Sub>
        </Section>

        <Section id="use" title="4. Penggunaan Data">
          <p>Kami menggunakan data yang dikumpulkan untuk:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Menyediakan dan meningkatkan layanan platform</li>
            <li>Memproses transaksi keuangan</li>
            <li>Mendeteksi dan mencegah kecurangan, penipuan, dan penyalahgunaan</li>
            <li>Memenuhi kewajiban hukum dan regulasi</li>
            <li>Mengirim notifikasi terkait akun (tidak untuk marketing tanpa persetujuan)</li>
            <li>Menyelesaikan sengketa dan investigasi</li>
          </ul>
          <p className="mt-3">
            Kami <strong>tidak</strong> menjual data pribadi kamu kepada pihak ketiga.
            Kami <strong>tidak</strong> menggunakan data kamu untuk iklan bertarget.
          </p>
        </Section>

        <Section id="sharing" title="5. Berbagi Data">
          <p>Data kamu hanya dibagikan kepada:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Supabase (PostgreSQL)</strong> — penyimpanan database kami, berlokasi di
              wilayah Asia Pacific (Singapura). Data dienkripsi saat transit dan saat istirahat.
            </li>
            <li>
              <strong>Midtrans</strong> — gateway pembayaran untuk transaksi deposit dan penarikan.
              Tunduk pada kebijakan privasi Midtrans dan regulasi OJK Indonesia.
            </li>
            <li>
              <strong>Penegak Hukum</strong> — jika diwajibkan oleh hukum atau perintah pengadilan
              yang sah di Indonesia.
            </li>
          </ul>
        </Section>

        <Section id="retention" title="6. Retensi Data">
          <p>
            Kami menyimpan data kamu hanya selama diperlukan untuk tujuan yang tercantum dalam
            kebijakan ini atau sesuai kewajiban hukum. Setelah periode retensi berakhir, data
            dihapus secara aman atau dianonimkan.
          </p>
          <p>
            Setelah akun ditutup, data non-keuangan akan dihapus dalam 90 hari.
            Data keuangan dan log audit disimpan selama 10 tahun sesuai regulasi.
            Data anti-cheat disimpan selama 2 tahun untuk keperluan investigasi.
          </p>
        </Section>

        <Section id="security" title="7. Keamanan Data">
          <ul className="list-disc pl-5 space-y-1">
            <li>Kata sandi di-hash dengan <strong>bcrypt (cost factor 12)</strong> — tidak pernah disimpan dalam bentuk plain text</li>
            <li>Semua koneksi menggunakan <strong>TLS/HTTPS</strong></li>
            <li>Token JWT dengan masa berlaku terbatas</li>
            <li>Move token kriptografis per-gerakan untuk mencegah replay attack</li>
            <li>IP address tidak pernah disimpan dalam bentuk raw — hanya hash SHA-256</li>
            <li>Row Level Security (RLS) di database — setiap pengguna hanya bisa mengakses datanya sendiri</li>
            <li>Content Security Policy (CSP) dan Helmet.js headers</li>
          </ul>
          <p className="mt-3 text-zinc-400 text-xs">
            Meskipun kami mengambil langkah-langkah keamanan yang wajar, tidak ada sistem yang
            100% aman. Laporkan kerentanan keamanan ke {CONTACT_EMAIL}.
          </p>
        </Section>

        <Section id="rights" title="8. Hak Pengguna">
          <p>Berdasarkan UU PDP dan prinsip privasi yang kami anut, kamu berhak:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li><strong>Akses</strong> — meminta salinan data pribadi yang kami simpan tentangmu</li>
            <li><strong>Koreksi</strong> — memperbarui informasi yang tidak akurat melalui pengaturan akun</li>
            <li><strong>Penghapusan</strong> — meminta penghapusan data, dengan pengecualian data yang diperlukan untuk kewajiban hukum atau investigasi aktif</li>
            <li><strong>Portabilitas</strong> — meminta ekspor data dalam format yang dapat dibaca mesin</li>
            <li><strong>Keberatan</strong> — menolak pemrosesan data untuk kepentingan sah kami (dengan konsekuensi tidak dapat menggunakan layanan)</li>
            <li><strong>Penjelasan anti-cheat</strong> — meminta penjelasan mengapa akunmu ditandai (sesuai batasan Bagian 3.4)</li>
          </ul>
          <p className="mt-3">
            Kirim permintaan hak pengguna ke {CONTACT_EMAIL}. Kami akan merespons dalam 30 hari kerja.
          </p>
        </Section>

        <Section id="cookies" title="9. Cookie & Teknologi Serupa">
          <p>
            Platform kami menggunakan penyimpanan lokal browser (localStorage) untuk menyimpan
            preferensi pengguna dan token sesi. Kami <strong>tidak</strong> menggunakan cookie
            pihak ketiga atau pixel pelacak iklan.
          </p>
          <p>
            Token sesi disimpan secara lokal dan dikirim ke server hanya untuk autentikasi.
            Menghapus localStorage browser akan membuatmu keluar dari akun.
          </p>
        </Section>

        <Section id="children" title="10. Data Anak-Anak">
          <p>
            Platform ini ditujukan untuk pengguna berusia 18 tahun ke atas. Kami tidak secara
            sengaja mengumpulkan data dari anak-anak di bawah 18 tahun. Jika kami menemukan
            bahwa data tersebut telah dikumpulkan, kami akan menghapusnya segera.
          </p>
          <p>
            Jika kamu percaya bahwa anak di bawah umur telah mendaftar di platform kami,
            harap hubungi {CONTACT_EMAIL} segera.
          </p>
        </Section>

        <Section id="changes" title="11. Perubahan Kebijakan">
          <p>
            Kebijakan ini dapat diperbarui untuk mencerminkan perubahan praktik kami atau
            regulasi yang berlaku. Perubahan material akan diberitahukan via email minimal
            14 hari sebelum berlaku. Versi historis kebijakan tersedia atas permintaan.
          </p>
        </Section>

        <Section id="contact" title="12. Kontak & DPO">
          <p>Untuk pertanyaan, permintaan hak pengguna, atau pelaporan kerentanan privasi:</p>
          <ul className="list-none space-y-2 mt-2">
            <li>📧 Privacy & DPO: <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-400">{CONTACT_EMAIL}</a></li>
            <li>📧 Support umum: <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-400">{CONTACT_EMAIL}</a></li>
          </ul>
          <p className="mt-3 text-zinc-500 text-xs">
            Kami berusaha merespons semua permintaan privasi dalam 30 hari kerja.
            Untuk permintaan mendesak terkait pelanggaran data, tambahkan "[URGENT]" di subject email.
          </p>
        </Section>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-white/10 flex flex-wrap gap-4 text-sm text-zinc-500">
          <Link href="/terms" className="text-amber-400 hover:underline">Syarat Layanan</Link>
          <Link href="/appeal" className="text-amber-400 hover:underline">Banding</Link>
          <Link href="/dashboard" className="text-amber-400 hover:underline">Dashboard</Link>
          <span className="ml-auto">© 2026 {COMPANY}. Seluruh hak dilindungi.</span>
        </div>

      </div>
    </div>
  );
}
