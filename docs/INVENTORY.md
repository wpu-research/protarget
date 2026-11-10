# Manuel envanter — 10 Kasım 2026

Bu geliştirme yerel çalışma ağacındadır; Railway'e yayımlanmamıştır.
Faz 0 kabulü veya ertelenen güvenlik/operasyon işleri kapanmış sayılmaz.

## Kullanım

1. Yönetici olarak **Gemiler / mekânlar** bölümünde gemiyi kaydedin.
   Varsayılan tür `ferry`; ad, şehir, ülke ve IANA saat dilimi zorunludur.
2. **Ekranlar** bölümünden gemiye bağlı ekran oluşturun. Fiziksel kod
   kırpılır ve büyük harfe çevrilir; benzersizdir. Kilitli kod değiştirilemez.
   Adreslerde bu kod değil kayıt UUID'si kullanılır.
3. Bilinmeyen donanım, CMS, OS, çözünürlük ve yayın saatlerini boş bırakın.
   Bunlar `null` saklanır; varsayılan bir kapasite veya “online” durumu üretilmez.
   CMS alanlarına parola, erişim anahtarı veya gizli bağlantı yazmayın.
4. Ekran detayındaki **Çarpan sürümleri / geçmişi** bölümünde pozitif bir
   ondalık değer, kaynak referansı ve değişiklik gerekçesiyle taslak oluşturun.
   Değer en fazla 8 tam ve 4 kesir basamağıdır; API'ye string gönderilir.
5. Taslağı ayrı bir işlemle onaylayın. Başlangıç sunucunun şimdiki zamanı
   veya ileri tarih olabilir; geçmişe onay verilmez. Mevcut açık uçlu
   sürümün yerine geçecekse ilgili sürümü açıkça seçip kapatmayı onaylayın.

Onay kaynağı doğrulamaz. Yeni kaynak türü **MANUAL / manuel-tahmini**;
eski `MANUAL_VERIFIED` kayıtları yeniden etiketlenmez. Çarpan hesabı,
teslimat girişi veya impression raporu bu story'de uygulanmaz.

## Kurallar

- Yalnız ADMIN okur/yazar. Ajans, reklamveren ve destek doğrudan API ile de
  erişemez; müşteri portalına envanter görünürlüğü eklenmedi.
- Gemi/ekran silinmez, pasifleştirilir. Aktif ekranı olan gemi
  pasifleştirilemez; önce ekranlarını kapatın. Bu işlem fiziksel CMS'yi durdurmaz.
- Pasif gemiye ekran atanamaz veya ekranı aktifleştirilemez.
- Girilmiş çözünürlük/loop/slot pozitif tam sayıdır. Slot loop'u aşamaz.
  Çalışma saatleri birlikte girilir/temizlenir; geceye taşabilir, eşit olamaz.
- Onay aralığı başlangıç dahil, bitiş hariçtir: `[validFrom, validTo)`.
  Aynı ekran için çakışan onaylar reddedilir; eski daypart profilleri de
  kontrol edilir. Daypart/hafta günü düzenleme bu MVP ekranında yoktur.
- Önceki sürümün değeri, kaynağı ve hesap referansları korunur. Açık uçlu
  öncülün bitişi yeni başlangıca çekilir; onayla birlikte atomik audit yazılır.
- **Şu anda geçerli** ile **son oluşturulan** ayrı gösterilir. Gelecek
  onay veya taslak, geçerli sürüm gibi sunulmaz. Ekran sunucu anlık görüntü
  zamanını gösterir; “Yenile” güncel durumu getirir.
- Saklama UTC'dir. Geçmiş ekranın saat diliminde; onay girişleri formda
  belirtilen tarayıcı saat diliminden UTC'ye çevrilerek gönderilir.
- Listeler ve gemi seçimi sayfalıdır; filtreler ve seçili pasif gemi korunur.
  Dil değişimi kaydedilmemiş formu silmez.

## API

Tüm yollar `/api/v1` altında, cookie oturumu ve mutasyonlarda doğru Origin
gerektirir. Yeni yanıt şemaları `openapi.json` içindedir.

| Yol | İşlemler |
|---|---|
| `/venues` | GET liste, POST oluştur |
| `/venues/:id` | GET detay, PATCH güncelle |
| `/screens` | GET liste, POST oluştur |
| `/screens/:id` | GET detay, PATCH güncelle |
| `/screens/:screenId/multipliers` | GET geçmiş, POST taslak |
| `/screens/:screenId/multipliers/:id/approve` | POST onay |

`page`/`pageSize` varsayılanları 1/20; `pageSize` en fazla 100.
Listeler `active=true|false`, ekran listesi ayrıca `venueId` kabul eder.
PATCH yalnız değişen alanları alır; boş PATCH reddedilir. Onayda
`validFrom` atlanırsa sunucu zamanı, `validTo` atlanırsa açık uç kullanılır.
`supersedesId` seçilen önceki onaydır; eski/kapalı/başka ekrana ait kimlik reddedilir.

## Migration ve doğrulama

Üç yeni migration (toplam altı) eski satırları silmez veya kaynaklarını
yeniden yazmaz. Kodların büyük harf/kırpılmış biçimi için benzersizlik eklenir;
son migration kenar boşluklarında JavaScript `trim()` ile aynı karakter
kümesini kullanır (tab, satır sonu ve Unicode boşlukları dahil). Eski kodun
saklanan yazımı değişmez. Mevcut kanonik mükerrer kod varsa migration durur;
kayıtlar otomatik birleştirilmez. Yayın öncesi bu durum migration-owner
tarafından incelenmelidir.

Eski slot/loop veya saat tutarsızlıkları korunur: metadata düzenleme,
pasifleştirme ve çarpan ekleme bunları sessizce düzeltmez. Yeni kayıtlar ve
gerçekten değiştirilen zamanlama grupları hem API hem DB trigger'larıyla
doğrulanır; bir grubu düzeltmek diğerini değiştirmeyi gerektirmez.
Özgün pozitif-boyut, çarpan aralığı/çakışma ve audit kısıtları korunur.

Arayüz yalnız değişen alanları gönderir. Eski hatalı saatler ham metin
olarak görünür; açıkça temizlenmedikçe veya düzeltilmedikçe korunur. Eski
ekran kodunu değiştirip ilk görünen değerine döndürmek de kodu yeniden
yazmaz. Ekran kaydı ve form içinden yeni gemi oluşturma aynı anda çalışmaz.
Onay geçmişi yenilendiğinde veya çakışma döndüğünde öncül seçenekleri ve
onay kutuları yenilenir; girilmiş tarihler korunur.

Node 24.22.2 ve mevcut lockfile kullanılır. Doğrulama adımları README'dedir;
sonuçlar ve açık kabul işleri `ACCEPTANCE.md` içinde tutulur.
Doğrudan yerel testte Railway'e özgü `PROXY_SHARED_SECRET`,
`TRUSTED_INGRESS` ve `RAILWAY_ENVIRONMENT_ID` ayarlanmaz. Üretim ayarlarını
gevşetmeyin; testleri ayrı yerel ortamda çalıştırın.
