import Link from 'next/link';
import { Shield, ChevronRight } from 'lucide-react';

export const metadata = {
  title: 'Syarat & Ketentuan — Chess Arena',
  description: 'Syarat & Ketentuan Chess Arena — platform kompetisi catur skill-based Indonesia. Bukan perjudian.',
  robots: 'index, follow',
};

const EFFECTIVE_DATE = '3 April 2026';
const COMPANY       = 'Chess Arena';
const CONTACT_EMAIL = 'igrahateknik@gmail.com';
const SUPPORT_EMAIL = 'igrahateknik@gmail.com';

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

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-secondary)]">

      {/* Header */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)]">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <div className="w-8 h-8 flex-shrink-0 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
              <span className="text-base leading-none">♔</span>
            </div>
            <span className="text-[var(--text-primary)]">Chess<span className="text-amber-400">Arena</span></span>
          </Link>
          <ChevronRight size={16} className="text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)] text-sm">Syarat Layanan</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">

        {/* Title */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Shield size={20} className="text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">Syarat Layanan</h1>
          </div>
          <p className="text-zinc-400 text-sm">
            Berlaku sejak: <strong className="text-zinc-200">{EFFECTIVE_DATE}</strong>
          </p>
          {/* Skill-based competition notice */}
          <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-300">
            <strong>⚡ Kompetisi Berbasis Skill — Bukan Perjudian</strong>
            <p className="mt-2 text-emerald-200/80">
              Chess Arena adalah platform <strong>turnamen catur kompetitif</strong> yang beroperasi seperti
              Chess.com Tournaments, FIDE events, dan kompetisi esports. Biaya entri turnamen adalah
              <strong> biaya partisipasi kompetisi</strong> — bukan taruhan. Hadiah diberikan kepada pemain terbaik
              berdasarkan skill bermain catur, bukan keberuntungan. Fitur Main Cepat (halaman Main) sepenuhnya gratis.
            </p>
          </div>
          <div className="mt-3 p-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-sm text-[var(--text-secondary)]">
            <strong>Penting:</strong> Dengan menggunakan platform {COMPANY}, kamu menyetujui seluruh syarat
            dalam dokumen ini. Baca dengan seksama sebelum mendaftar.
          </div>
        </div>

        {/* Table of Contents */}
        <div className="mb-10 p-5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
          <h2 className="font-semibold text-[var(--text-primary)] mb-3 text-sm uppercase tracking-wide">Daftar Isi</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">
            {[
              ['#acceptance', '1. Penerimaan Syarat'],
              ['#eligibility', '2. Kelayakan Pengguna'],
              ['#account', '3. Akun & Keamanan'],
              ['#real-money', '4. Sistem Kompetisi & Hadiah'],
              ['#anticheat', '5. Kebijakan Anti-Cheat'],
              ['#enforcement', '6. Penegakan & Sanksi'],
              ['#appeal', '7. Proses Banding'],
              ['#dispute', '8. Penyelesaian Sengketa'],
              ['#liability', '9. Batasan Tanggung Jawab'],
              ['#termination', '10. Penghentian Akun'],
              ['#changes', '11. Perubahan Syarat'],
              ['#contact', '12. Kontak'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="text-amber-400 hover:text-amber-300 transition-colors py-0.5">
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        <Section id="acceptance" title="1. Penerimaan Syarat">
          <p>
            Dengan mengakses atau menggunakan layanan {COMPANY} ("Platform"), kamu menyatakan bahwa
            kamu telah membaca, memahami, dan setuju untuk terikat oleh Syarat Layanan ini beserta
            Kebijakan Privasi kami.
          </p>
          <p>
            Jika kamu tidak setuju dengan syarat ini, jangan gunakan Platform. Penggunaan berkelanjutan
            setelah perubahan syarat diterbitkan merupakan penerimaan atas perubahan tersebut.
          </p>
        </Section>

        <Section id="eligibility" title="2. Kelayakan Pengguna">
          <p>Untuk menggunakan Platform, kamu harus memenuhi syarat berikut:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Berusia minimal <strong>18 tahun</strong></li>
            <li>Mampu secara hukum untuk mengikat perjanjian yang mengikat secara hukum</li>
            <li>Berdomisili di Indonesia atau yurisdiksi yang mengizinkan kompetisi skill-based online</li>
            <li>Tidak sebelumnya di-banned permanen dari Platform</li>
          </ul>
          <p className="mt-3">
            {COMPANY} berhak meminta verifikasi identitas kapan saja, terutama sebelum penarikan dana.
            Akun yang tidak dapat diverifikasi dapat dibekukan sementara.
          </p>
        </Section>

        <Section id="account" title="3. Akun & Keamanan">
          <Sub title="3.1 Satu Akun Per Pengguna">
            <p>
              Setiap pengguna hanya diperbolehkan memiliki <strong>satu akun</strong>. Pembuatan beberapa akun
              ("multi-accounting") untuk tujuan apapun — termasuk menghindari sanksi, memanipulasi
              rating, atau mengakumulasi bonus — merupakan pelanggaran serius dan dapat mengakibatkan
              penutupan semua akun terkait.
            </p>
          </Sub>
          <Sub title="3.2 Keamanan Akun">
            <p>
              Kamu bertanggung jawab menjaga kerahasiaan kredensial akunmu. {COMPANY} tidak bertanggung jawab
              atas kerugian akibat akses tidak sah ke akunmu. Laporkan segera jika akunmu diakses
              pihak yang tidak berwenang ke {SUPPORT_EMAIL}.
            </p>
          </Sub>
          <Sub title="3.3 Informasi Akurat">
            <p>
              Kamu wajib memberikan informasi yang akurat dan terkini saat mendaftar. Nama dan informasi
              keuangan yang salah dapat mengakibatkan pembekuan penarikan dana.
            </p>
          </Sub>
        </Section>

        <Section id="real-money" title="4. Sistem Kompetisi & Hadiah">
          <p className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-xs">
            <strong>Main Cepat (halaman Main) sepenuhnya GRATIS</strong> — tidak ada biaya apapun.
            Biaya entri hanya berlaku untuk turnamen, mirip seperti biaya pendaftaran turnamen catur resmi.
          </p>
          <Sub title="4.1 Setoran (Deposit)">
            <p>
              Setoran ke wallet Chess Arena diproses melalui Midtrans Payment Gateway yang berlisensi OJK.
              Minimum setoran adalah Rp 10.000. Dana setoran digunakan untuk membayar entry fee tournament.
              Setoran tidak dapat dikembalikan kecuali ada kesalahan teknis yang dapat diverifikasi.
            </p>
          </Sub>
          <Sub title="4.2 Penarikan (Withdrawal)">
            <p>
              Penarikan hadiah tournament memerlukan verifikasi identitas. Diproses dalam 1–3 hari kerja.
              Biaya admin penarikan dapat berlaku sesuai metode yang dipilih. {COMPANY} berhak menahan
              penarikan untuk keperluan investigasi anti-kecurangan.
            </p>
          </Sub>
          <Sub title="4.3 Biaya Entri Turnamen">
            <p>
              Entry fee tournament adalah <strong>biaya partisipasi kompetisi</strong>, bukan taruhan.
              Konsepnya identik dengan pendaftaran turnamen catur FIDE, liga esports, atau kompetisi
              skill-based lainnya. Hadiah tournament (prize pool) dikumpulkan dari entry fee peserta
              dan didistribusikan kepada pemain dengan performa terbaik berdasarkan hasil pertandingan.
            </p>
            <p className="mt-2">
              Platform fee (10%) digunakan untuk biaya operasional, infrastruktur server, dan
              pengembangan platform. Rincian distribusi hadiah ditampilkan secara transparan
              sebelum mendaftar tournament.
            </p>
          </Sub>
          <Sub title="4.4 Pengembalian Dana">
            <p>
              Pengembalian entry fee tournament diberikan dalam kondisi: (a) tournament dibatalkan
              oleh platform, (b) kesalahan teknis platform yang terdokumentasi, atau (c) terbukti ada
              pelanggaran anti-cheat oleh lawan yang mempengaruhi hasil. Pengajuan melalui {SUPPORT_EMAIL}
              dalam 7 hari setelah kejadian.
            </p>
          </Sub>
          <Sub title="4.5 Natura Kompetisi Skill-Based">
            <p>
              Hasil tournament sepenuhnya ditentukan oleh kemampuan bermain catur (skill), bukan
              keberuntungan. {COMPANY} beroperasi sebagai penyelenggara kompetisi (organizer),
              bukan sebagai bandar. Platform tidak mengambil posisi bertentangan dengan pemain.
            </p>
          </Sub>
        </Section>

        <Section id="anticheat" title="5. Kebijakan Anti-Cheat">
          <p>
            {COMPANY} berkomitmen menjaga integritas permainan. Platform menggunakan sistem deteksi
            multi-lapisan yang beroperasi secara otomatis dan transparan.
          </p>
          <Sub title="5.1 Tindakan yang Dilarang">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Penggunaan engine/AI chess</strong> — menggunakan software seperti Stockfish, Komodo, atau asisten AI untuk menentukan gerakan</li>
              <li><strong>Multi-accounting</strong> — membuat akun kedua untuk menghindari deteksi, memanipulasi rating, atau mengumpulkan bonus</li>
              <li><strong>Kolusi</strong> — berkoordinasi dengan lawan untuk mengatur hasil pertandingan (match-fixing), termasuk surrender terencana</li>
              <li><strong>Rating farming</strong> — bermain berulang dengan akun yang sama untuk manipulasi ELO</li>
              <li><strong>Material gifting</strong> — menyerahkan bidak berharga secara sengaja untuk menguntungkan lawan dalam skema kolusi</li>
              <li><strong>Abuse disconnect</strong> — sengaja disconnect berulang untuk menghindari kekalahan</li>
            </ul>
          </Sub>
          <Sub title="5.2 Metode Deteksi">
            <p>Platform menggunakan, namun tidak terbatas pada:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Analisis timing gerakan dan pola konsistensi</li>
              <li>Perbandingan gerakan dengan rekomendasi engine Stockfish</li>
              <li>Deteksi anomali ELO dan pola kemenangan</li>
              <li>Device fingerprinting untuk deteksi multi-account</li>
              <li>Analisis pasangan pemain dan pola kolusi</li>
            </ul>
            <p className="mt-2 text-zinc-400 text-xs">
              Sistem deteksi dapat menghasilkan false positive. Oleh karena itu setiap keputusan
              suspend otomatis dapat dibanding melalui proses banding resmi.
            </p>
          </Sub>
        </Section>

        <Section id="enforcement" title="6. Penegakan & Sanksi">
          <Sub title="6.1 Trust Score">
            <p>
              Setiap akun memiliki Trust Score (0–100). Poin dikurangi jika sistem mendeteksi
              pelanggaran. Skor rendah mengakibatkan peringatan, pembatasan, dan akhirnya suspensi.
            </p>
          </Sub>
          <Sub title="6.2 Tingkat Sanksi">
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Trust Score</th>
                    <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Status</th>
                    <th className="text-left py-2 text-zinc-400 font-medium">Dampak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr><td className="py-2 pr-4 font-mono text-green-400">80–100</td><td className="py-2 pr-4">Good Standing</td><td className="py-2">Akses penuh</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-yellow-400">60–79</td><td className="py-2 pr-4">Warning</td><td className="py-2">Notifikasi, monitoring ketat</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-orange-400">35–59</td><td className="py-2 pr-4">Flagged</td><td className="py-2">Akun ditandai, admin review</td></tr>
                  <tr><td className="py-2 pr-4 font-mono text-red-400">0–34</td><td className="py-2 pr-4">Suspended</td><td className="py-2">Akses dibatasi, penarikan ditahan</td></tr>
                </tbody>
              </table>
            </div>
          </Sub>
          <Sub title="6.3 Keputusan Admin">
            <p>
              Semua suspensi otomatis ditinjau oleh admin manusia dalam <strong>48 jam</strong>.
              Admin dapat mengkonfirmasi, mengurangi, atau membatalkan sanksi berdasarkan
              bukti yang tersedia.
            </p>
          </Sub>
        </Section>

        <Section id="appeal" title="7. Proses Banding">
          <p>
            Jika akunmu terkena flag atau suspensi yang kamu yakini tidak adil, kamu berhak
            mengajukan banding melalui halaman <Link href="/appeal" className="text-amber-400 hover:underline">Appeal</Link>.
          </p>
          <Sub title="7.1 Ketentuan Banding">
            <ul className="list-disc pl-5 space-y-1">
              <li>Maksimal <strong>3 banding</strong> per akun seumur hidup</li>
              <li>Setiap banding ditinjau dalam <strong>48 jam kerja</strong></li>
              <li>Keputusan admin bersifat final setelah proses banding selesai</li>
              <li>Informasi palsu dalam banding dapat mengakibatkan ban permanen</li>
            </ul>
          </Sub>
          <Sub title="7.2 Proses Review">
            <p>
              Admin akan meninjau: riwayat permainan, log gerakan, data waktu, serta keterangan
              yang kamu berikan. Keputusan diinformasikan melalui notifikasi platform dan/atau email.
            </p>
          </Sub>
          <Sub title="7.3 Eskalasi">
            <p>
              Jika banding ditolak dan kamu masih merasa ada ketidakadilan, kamu dapat menghubungi
              tim legal kami di {CONTACT_EMAIL} dengan referensi ID banding.
            </p>
          </Sub>
        </Section>

        <Section id="dispute" title="8. Penyelesaian Sengketa">
          <Sub title="8.1 Sengketa Permainan">
            <p>
              Sengketa terkait hasil permainan diselesaikan berdasarkan log server yang bersifat
              definitif. Log tersebut mencakup setiap gerakan, timestamp server, dan FEN board state
              yang tidak dapat dimanipulasi oleh klien.
            </p>
          </Sub>
          <Sub title="8.2 Sengketa Keuangan">
            <p>
              Sengketa terkait deposit atau penarikan harus dilaporkan dalam 7 hari kalender
              ke {SUPPORT_EMAIL}. Sertakan ID transaksi dan tangkapan layar relevan.
            </p>
          </Sub>
          <Sub title="8.3 Hukum yang Berlaku">
            <p>
              Syarat ini tunduk pada hukum Republik Indonesia. Sengketa yang tidak dapat diselesaikan
              secara kekeluargaan akan diserahkan ke Pengadilan Negeri yang berwenang di Indonesia.
            </p>
          </Sub>
        </Section>

        <Section id="liability" title="9. Batasan Tanggung Jawab">
          <p>
            {COMPANY} tidak bertanggung jawab atas: (a) gangguan layanan akibat force majeure atau
            pemeliharaan terjadwal, (b) kerugian akibat keputusan bermain yang kamu buat,
            (c) tindakan pihak ketiga yang tidak berada di bawah kendali kami.
          </p>
          <p>
            Tanggung jawab maksimal {COMPANY} kepada kamu dalam kondisi apapun tidak melebihi
            jumlah yang kamu depositkan dalam 30 hari terakhir.
          </p>
        </Section>

        <Section id="termination" title="10. Penghentian Akun">
          <p>
            Kamu dapat menutup akunmu kapan saja dengan menghubungi {SUPPORT_EMAIL}.
            Saldo yang tersisa akan dikembalikan setelah verifikasi identitas, dikurangi biaya
            administrasi yang berlaku.
          </p>
          <p>
            {COMPANY} berhak menghentikan akun yang melanggar Syarat ini, dengan atau tanpa
            pemberitahuan. Akun yang dihentikan karena pelanggaran berat tidak berhak mendapat
            pengembalian saldo.
          </p>
        </Section>

        <Section id="changes" title="11. Perubahan Syarat">
          <p>
            {COMPANY} dapat memperbarui Syarat ini sewaktu-waktu. Perubahan material akan
            diberitahukan melalui email terdaftar dan/atau notifikasi platform minimal 14 hari
            sebelum berlaku. Penggunaan berkelanjutan setelah tanggal efektif merupakan penerimaan.
          </p>
        </Section>

        <Section id="contact" title="12. Kontak">
          <p>Pertanyaan tentang Syarat ini dapat dikirim ke:</p>
          <ul className="list-none space-y-1 mt-2">
            <li>📧 Legal: <a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-400">{CONTACT_EMAIL}</a></li>
            <li>📧 Support: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-amber-400">{SUPPORT_EMAIL}</a></li>
          </ul>
        </Section>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-white/10 flex flex-wrap gap-4 text-sm text-zinc-500">
          <Link href="/privacy" className="text-amber-400 hover:underline">Kebijakan Privasi</Link>
          <Link href="/appeal" className="text-amber-400 hover:underline">Banding</Link>
          <Link href="/dashboard" className="text-amber-400 hover:underline">Dashboard</Link>
          <span className="ml-auto">© 2026 {COMPANY}. Seluruh hak dilindungi.</span>
        </div>

      </div>
    </div>
  );
}
