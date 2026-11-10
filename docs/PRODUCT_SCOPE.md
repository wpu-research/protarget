# Ürün kapsamı — telefon görüşmesi sonrası netleştirme

Kaynak: kullanıcının 10 Kasım 2026 tarihli açıklaması.
Bu belge uygulamanın tamamlandığını değil, ürünün öncelik sırasını tarif eder.

**Güncelleme:** Sonraki keşif yanıtları `MVP_DECISIONS.md` belgesindedir.
MVP'de gerçek DSP/SSP ve dış Deal ID yok; manuel CMS operasyonu kabul edildi.
Bu tarihsel not ile çelişen maddelerde yeni karar belgesi önceliklidir.

## Birinci ürün aşaması: gemi ekranlarında reklam operasyonu

Operasyon Protarget yöneticisinin panelinden yürütülür:

1. Reklamveren ve kampanya kaydı oluşturulur.
2. Reklam dosyası/kreatif eklenir.
3. Gemiler ve bu gemilerdeki ekranlar arasından yayın yapılacak ekranlar seçilir.
4. Başlangıç/bitiş tarihleri ve yayın saatleri belirlenir.
5. Tekrar/playout hedefi veya frekansı ile hedef tahmini gösterim girilir.
6. Ekran ve zaman aralığı için geçerli, kaynak bilgisi olan versiyonlu çarpan kullanılır.
7. Yayın planı, mevcut CMS'nin doğrulanmış yeteneklerine göre operatör tarafından
   uzaktan yüklenir veya CMS entegrasyonuyla aktarılır. Kendi player/ajanımızı
   kurmak, mevcut CMS incelenmeden zorunlu varsayılmaz.
8. Operatör hedef, gerçekleşen oynatma ve tahmini gösterim ilerlemesini izler.

Gemiler mevcut venue/ferry yaklaşımıyla modellenebilir; ekranlar gemiye bağlı
envanterdir. Pilot ekranların işletim sistemi henüz teyit edilmediğinden
belirli bir donanım/OS uyumluluğu tamamlanmış sayılmaz.

### CMS ve uzaktan erişim — ek görüşme notu

Kullanıcının aktardığı 10 Kasım 2026, 13:12–13:16 yazışmasına göre ekranların
mevcut CMS'leri incelenecek. İlk operasyon, CMS paneline uzaktan giriş yapıp
içeriği bir operatörün yüklemesi şeklinde olabilir. Bu, otomatik entegrasyon
veya cihazın işletim sistemine uzaktan masaüstü erişimi taahhüdü değildir.

Dört sorumluluk ayrı tutulur:

1. **Protarget operasyon paneli:** reklamveren, kampanya, ekran eşlemesi,
   yayın planı, hedef, çarpan ve teslimat kayıtları.
2. **CMS/player:** içeriğin ekranlara dağıtılması, zamanlanması ve oynatılması.
3. **SSP/exchange veya doğrulanmış satış tarafı entegrasyonu:** envanter/deal'in
   satın alma tarafına sunulması.
4. **DSP:** ajans/markanın anlaşmayı alıp kampanyasında kullanacağı satın alma
   tarafı. Bir sağlayıcının birden fazla rol sunması bu sorumlulukları birleştirmez.

Manuel başlangıç için önerilen iş akışı:
Protarget'ta plan hazırlanması → operatörün mevcut CMS'ye yüklemesi →
operatörün aktarımı kaydetmesi → varsa CMS/player yayın kayıtlarının alınması.
Operatörün “yükledim” onayı **PoP veya doğrulanmış gerçekleşen yayın değildir**.
CMS'nin raporu yalnızca planlamayı gösteriyorsa gerçek oynatma kanıtı gibi
sunulmaz; ölçüm kaynağı ve doğrulama düzeyi açıkça işaretlenir.

Entegrasyon öncesi istenecek bilgiler:

- CMS ürün adı/sürümü, ekran OS'si ve player modeli.
- Yetkili demo erişimi veya hassas bilgi içermeyen panel ekran görüntüleri.
- Ekran bazlı seçim, tarih/saat, tekrar, durdurma ve çevrimdışı yayın desteği.
- API/webhook erişimi ve bu erişimin lisans/yetki şartları.
- Kampanya/kreatif/ekran kimliği ile zaman damgalı başarılı/başarısız oynatma
  kayıtları; raporun dışa aktarım biçimi ve çevrimdışı kayıt senkronizasyonu.

Bu bilgiler doğrulanmadan “her ekran panelimizden otomatik yönetilir”,
“her yayın için kanıt alınır” veya “yeni player kurmaya gerek yoktur”
garantisi verilmez. Gerekli kayıt alınamıyorsa doğrulanmış teslimat sunumu
öncesinde CMS entegrasyonu, ek player veya başka bir ölçüm yöntemi seçilir.

Bir kampanyanın hem tekrar hem gösterim hedefi varsa, hangi hedefin yayını
durduracağını belirleyen kural kampanya/scheduling tasarımında açıkça seçilmeli;
ikisi aynı ölçü birimiymiş gibi işlenmemelidir.

## İkinci ürün aşaması: isteğe bağlı programatik paylaşım ve takip

Ajans/marka talep ederse kampanya bir deal kaydıyla ilişkilendirilir.
Ajansın DSP'sinde kullanılabilir bir deal oluşturulması, seçilecek
SSP/exchange veya desteklenen satış tarafı entegrasyonu, buyer/seat eşlemesi
ve erişim yetkileri üzerinden ayrıca uygulanır. İç panelde deal kaydı veya
deal ID oluşturmak, DSP'de anlaşmanın etkinleştiğini göstermez.
Manual ve Mock connector gerçek DSP aktarımı veya gerçekleşmiş satın alma
olarak gösterilmez.

İzlenmesi istenen alanlar:

- Kampanya/deal kimliği ve durumu.
- Yayın başlangıç/bitişi (flight).
- Hedef ve gerçekleşen tekrar/playout.
- Hedef ve hesaplanmış tahmini gösterim.
- Kampanya süresince ilerleme ve istenirse oynatma kanıtları.

**“Lifetime takibi” yorumu (henüz teyit edilmedi):** kampanyanın başlangıcından
bitişine kadar kümülatif teslimat ve durum takibi. Bu ifade, tek başına
DSP'nin desteklediği belirli bir API alanı veya bütçe modeli kabul edilmez.

## Ölçüm ve kanıt sınırı

- PoP, bir oynatma gerçekleştiğine ilişkin player kaydıdır; fiziksel izleyicinin
  reklamı gerçekten gördüğünün kanıtı olarak sunulmaz.
- Tahmini gösterim, başarılı oynatmalar ve o zaman geçerli çarpan üzerinden
  hesaplanır; tekil kişi sayısı olarak adlandırılmaz.
- Ajansa sunum/programatik entegrasyon sonraki aşama olsa da ilk gerçek yayından
  itibaren PoP ve çarpan versiyonları tutulur. Sonradan geçmiş oynatmalar için
  kanıt veya ölçüm kaydı uydurulmaz.
- İç teslimat verisi ve dış DSP raporu ayrı tutulur; farklar gizlenmez.

## Mevcut geliştirmeye etkisi

Faz 0 (kimlik, roller, organizasyon izolasyonu, audit ve altyapı) değişmedi.
“Birinci/ikinci ürün aşaması”, kaynak prompttaki teknik Faz 0–8 numaralarının
yeniden adlandırılması değildir:

- Operasyonel ürün: teknik Faz 0–4'ün gereken işlevleri ve gerekli
  pause/resume kontrolleri. Mevcut CMS'nin hangi işlevleri sağlayacağı
  doğrulandıktan sonra CMS entegrasyonu/kendi player'ımız ayrımı kararlaştırılır;
  kaynak faz planı bu notla sessizce değiştirilmez.
- Ajans sunumu/programatik katman: teknik Faz 5–7, ihtiyaca göre.
- Güvenlik, kayıt dayanıklılığı ve gerekli operasyon kontrolleri, ilk gerçek
  yayın öncesinde doğrulanır; yalnızca son faza bırakılmış sayılmaz.

Bu netleştirme mevcut foundation kapsamına kampanya, player veya canlı
connector uygulamasını eklemez.
