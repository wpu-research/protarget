# Geliştirme sırası

Kaynak: `MVP_DECISIONS.md`. Eski BUILD_PROMPT teknik fazları gereksinim kaynağıdır;
manuel CMS kararı sonrası zorunlu olmayan player/programatik işleri ayrı tutulur.

1. **Faz 0 — Secure foundation (mevcut story):** auth, kurum/kullanıcı/davet,
   tenant izolasyonu, audit, gerçek arayüz, TR/EN, test ve Docker altyapısı.
   Yerel doğrulama tamam; Compose runtime ve review sonucu bekleniyor.
2. **Envanter (yerel uygulama):** gemi/ekran, mevcut CMS/OS metadata, manuel
   çarpan sürümleri, ayrı onay ve geçmiş arayüzü uygulandı. Teknik uygulama,
   dokuz inceleme düzeltmesi ve 198 test tamamlandı; Faz 0 önkoşulu nedeniyle
   sprint/kabul durumu `review`. Canlıya yayımlanmadı. Donanım/OS uyumluluğunu
   keşfetmeden player kurulumu taahhüdü yok.
3. **Kampanya/booking:** ajans/marka ilişkisi, kreatif, ekran/tarih/hedef,
   CMS'ye manuel aktarım checklist'i ve operatör işlem kayıtları.
4. **Teslimat:** manuel beyan, doğrulanmış CMS import'u, kaynak/doğrulama
   etiketleri, tekilleştirme ve audit'li düzeltmeler. Hedef/gerçekleşen ayrımı.
5. **Müşteri raporu:** yalnız yetkili kampanyalar; ekran/tarih, delivery/pacing,
   kaynak niteliği. Finansal alanlar kapalı varsayılan ve API tarafı filtreli.
6. **Pilot:** gerçek CMS kayıt örnekleri, bağlantı kesintisi ve saha kontrolleri.
7. **İsteğe bağlı gelecek:** otomatik CMS connector'ı; ayrı anlaşma ve teknik
   erişim doğrulamasından sonra gerçek SSP/DSP entegrasyonu.

Bir sonraki story, Faz 0 kabulü kapanmadan ve deferred güvenlik bulguları
pilot etkisi açısından değerlendirilmeden tamamlanmış sayılmaz. Ekran,
kampanya ve connector tablolarının şemada bulunması uygulanmış modül demek değildir.
