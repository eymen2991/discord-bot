const pcHataVeritabani = {
    // Mavi Ekran Kodları
    "0x0000007e": {
        baslik: "SYSTEM_THREAD_EXCEPTION_NOT_HANDLED (0x0000007E)",
        aciklama: "Genellikle hatalı bir sürücü veya uyumsuz donanım nedeniyle oluşur.",
        cozumler: [
            "⚠️ Ekran kartı ve Anakart sürücülerini (Chipset) güncelleyin.",
            "💻 BIOS sürümünüzün güncel olduğundan emin olun.",
            "🔍 RAM'lerinizi 'Windows Bellek Tanılama' veya 'MemTest86' ile test edin.",
            "🔌 Yeni taktığınız bir donanım varsa çıkartıp tekrar test edin."
        ]
    },
    "0x000000d1": {
        baslik: "DRIVER_IRQL_NOT_LESS_OR_EQUAL (0x000000D1)",
        aciklama: "Bir sürücü, sistem belleğine geçersiz bir adresten erişmeye çalıştı.",
        cozumler: [
            "🌐 Ağ (Ethernet/Wi-Fi) sürücülerinizi güncelleyin veya yeniden yükleyin.",
            "🛡️ Antivirüs yazılımınızın sürücüyle çakışıp çakışmadığını kontrol edin.",
            "🛠️ 'sfc /scannow' komutu ile sistem dosyalarını onarın."
        ]
    },
    "0x0000001a": {
        baslik: "MEMORY_MANAGEMENT (0x0000001A)",
        aciklama: "Ciddi bir bellek yönetim hatası tespit edildi.",
        cozumler: [
            "🧩 RAM slotlarını değiştirin veya tek tek deneyerek hangisinin hatalı olduğunu bulun.",
            "🛑 XMP/DOCP profilini BIOS'tan kapatıp varsayılan hızda test edin.",
            "💾 Disk sürücünüzde (SSD/HDD) hata olup olmadığını kontrol edin."
        ]
    },
    "0x0000007b": {
        baslik: "INACCESSIBLE_BOOT_DEVICE (0x0000007B)",
        aciklama: "Windows, sistem bölümüne erişemiyor.",
        cozumler: [
            "⚙️ BIOS ayarlarına girip SATA Modu'nun 'AHCI' olduğundan emin olun.",
            "🔌 SSD/HDD kablolarının gevşek olup olmadığını kontrol edin.",
            "📀 Windows Kurtarma ortamından başlangıç onarma yapın."
        ]
    },
    "0x00000050": {
        baslik: "PAGE_FAULT_IN_NONPAGED_AREA (0x00000050)",
        aciklama: "Geçersiz sistem belleği başvurusu yapıldı.",
        cozumler: [
            "🧹 RAM uçlarını silgi ile (hafifçe) temizleyip tekrar takın.",
            "🆙 Windows Güncelleştirmelerini tamamlayın.",
            "📂 Son yüklenen yazılımları 'Güvenli Mod' üzerinden kaldırın."
        ]
    },

    // Genel Donanım Sorunları
    "ekran kartı 80 derece": {
        baslik: "Yüksek Ekran Kartı Sıcaklığı",
        aciklama: "GPU sıcaklığınızın 80°C üzerine çıkması performans kaybına (Throttling) neden olur.",
        cozumler: [
            "🌬️ Kasa içi hava sirkülasyonunu kontrol edin, fanların çalıştığından emin olun.",
            "🧪 Ekran kartı termal macununu (varsa garantisi bittiyse) yenileyin.",
            "🧹 Kartın üzerindeki tozları temizleyin.",
            "📉 MSI Afterburner ile fan hızını manuel olarak yükseltin."
        ]
    },
    "ekranda çizgiler": {
        baslik: "Görüntüde Bozulmalar (Artifacting)",
        aciklama: "Genellikle GPU bellek hatası veya aşırı ısınma sinyalidir.",
        cozumler: [
            "🔌 HDMI/DisplayPort kablosunu farklı bir kabloyla değiştirip test edin.",
            "📉 GPU çekirdek ve bellek hızlarını (Overclock yaptıysanız) geri çekin.",
            "🖥️ Monitörünüzü başka bir cihazda deneyerek sorunun monitörde olmadığını teyit edin.",
            "🛠️ Sorun devam ediyorsa GPU'da donanımsal arıza (Reballing gereği) olabilir."
        ]
    },
    "bip sesi": {
        baslik: "BIOS Bip Kodları",
        aciklama: "Anakart üzerindeki hoparlörden gelen kısa/uzun sesler donanım hatasını işaret eder.",
        cozumler: [
            "🔊 Ses sayısını not edin (Örn: 1 uzun 3 kısa -> Genelde ekran kartı hatasıdır).",
            "🔋 CMOS pilini çıkartıp 1 dk bekleyerek BIOS'u sıfırlayın.",
            "🦴 RAM'leri söküp tek tek takarak çalıştırmayı deneyin."
        ]
    }
};

function getHataCozum(sorgu) {
    const normalize = (text) => text.toLowerCase().trim();
    const query = normalize(sorgu);

    // Tam eşleşme kontrolü
    if (pcHataVeritabani[query]) return pcHataVeritabani[query];

    // Anahtar kelime kontrolü
    for (const key in pcHataVeritabani) {
        if (query.includes(key) || key.includes(query)) {
            return pcHataVeritabani[key];
        }
    }

    return null;
}

module.exports = { getHataCozum, pcHataVeritabani };
