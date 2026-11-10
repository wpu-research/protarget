# MVP kararları — 10 Kasım 2026

Kaynak: kullanıcının keşif sorularına verdiği yanıtlar ve “devam et” onayı.
Önceki ürün kapsamı notundaki belirsiz/değişmiş noktalar için bu belge önceliklidir.
Bu belge işlevlerin tamamlandığı anlamına gelmez.

## Onaylanan kapsam

- Protarget kampanya/booking ve müşteri takip panelidir; MVP bir DSP/SSP değildir.
- Operatör kampanyayı panelimizde hazırlar, mevcut CMS'ye uzaktan **manuel**
  yükler. Otomatik aktarım ve kendi player'ımız ilk sürüm şartı değildir.
- Tekrar/playout hem ekran hem kampanya bazında takip edilir. Planlanan ve
  gerçekleşen değerler ayrı saklanır. Hedefte durdurma MVP'de manuel olabilir;
  panelde “durduruldu” kaydı fiziksel ekranın durduğunun otomatik kanıtı değildir.
- Ekran bazlı çarpanlar başlangıçta manuel tanımlanır. Gelecekte saat/sefer ve
  harici veri kaynaklarına genişletilebilir. Geçmiş hesaplar kullanılan çarpan
  sürümüyle korunur; yeni çarpan geçmişi sessizce değiştirmez.
- Gerçek CMS oynatma kaydı varsa alınır. Yoksa operatör bildirimi veya manuel
  impression girişi **beyan** olarak tutulabilir; doğrulanmış PoP sayılmaz.
- Doğrulanmış oynatma, beyan edilen oynatma ve doğrudan beyan edilen impression
  ayrı kaynaklardır. Aynı teslimatın içe aktarım/beyan yoluyla çift sayılması
  engellenir. Düzeltmeler audit ve gerekçe ile izlenir.
- Müşteri raporu: playout, tahmini impression, ekran/tarih kırılımı ve verinin
  kaynağı/doğrulama düzeyi. Ekran görüntüsü/video sonraya bırakılabilir.
- Dış platformda satın alınabilir Deal ID yoktur. UI terminolojisi “booking /
  rezervasyon” olur; eski Deal şeması gerçek programatik entegrasyon gibi sunulmaz.
- Lifetime: kampanya boyunca hedef/gerçekleşen impression, playout, delivery %,
  pacing ve durum. Gerçekleşen impression'ın tahmini veya beyan niteliği görünür.
- Ajans/marka yalnız kendi kampanyalarını salt okunur görür. Finansal alanlar
  organizasyon bazlı açılabilir; varsayılan kapalı, gizleme API sorgu/yanıtında da uygulanır.

## Henüz bilinmeyenler

CMS adı/sürümü, ekran OS/player modeli, uygulama kurma yetkisi, API/lisans,
gemi/ekran sayıları, çevrimdışı yayın ve kayıt senkronizasyonu, loop/slot
kapasitesi ve dışa aktarım biçimi. Bunlar manuel paneli engellemez; otomatik
ekran kontrolü veya doğrulanmış teslimat garantisi verilmesini engeller.

## Uygulama sırası

1. Mevcut Faz 0: giriş, roller, kurum izolasyonu, kullanıcı daveti, audit.
2. Gemi/ekran kaydı, manuel çarpan sürümleri; mevcut CMS bilgileri.
3. Kampanya/kreatif/booking, tarih/hedef, seçilen ekranlar ve CMS aktarım
   operasyon kaydı. Gerçek yükleme/oynatma ile planın statüleri ayrı.
4. Kaynak etiketli teslimat girişi/içe aktarımı, tekilleştirme, raporlama,
   ajans/markaya kendi kampanyalarının görünürlüğü.
5. Doğrulanmış CMS yeteneklerine göre otomasyon; gerçek DSP/SSP ayrı gelecek proje.

Kapasite/planlama ve pacing formülleri ilgili story'de tanımlanır. Hedef yoksa
oran “hesaplanamadı” olur; sıfır hedefe bölme veya eksik veriyi 0 gerçekleşme
gibi sunma yapılmaz. Finansal tutarların kaynağı/formülü belirlenmeden sahte
spend üretilmez. Kaynak BUILD_PROMPT.md korunur; değişen kapsamın referansı bu belgedir.
