---
title: 'Filo / 3D — İstanbul–Adalar hattı sahnesi'
type: 'feature'
created: '2026-11-12'
status: 'review'
acceptance_status: 'review'
target_file: 'tech-spec-fleet-adalar.md'
branch: 'story/fleet-adalar'
baseline_commit: 'dc3b32f'
context:
  - 'tech-spec-fleet-3d.md'
  - 'docs/FLEET.md'
---

# Filo / 3D — Adalar sahnesi

**Niyet:** Kullanıcının kurumsal sunumundaki ulaşım ağı (Sarıyer, Beşiktaş, Kabataş, Eminönü, Karaköy, Kadıköy, Bostancı iskeleleri → Kınalıada, Burgazada, Heybeliada, Büyükada) 3D sahnede görünsün; gemiler bu hatlarda hareket etsin. Kullanıcı "Adalar hattı sahnesini başlat" dedi (12 Kasım 2026).

**Sınırlar (fleet-3d ile aynı):** Rotalar ve hareket **simülasyondur** ("Simülasyon — gerçek konum değildir"); harita **stilizedir, mesafeler ölçeksizdir** (slayt pikselleri × 14 m). Seferler/tarife/AIS verisi yok; hat ataması gemi kimliğinden deterministiktir ve gerçek hat bilgisi değildir. Yeni API, migration veya yazma yolu yok. Boğaz sahnesi bölge seçicisiyle korunur; Adalar varsayılandır. Yayın ve `main`'e merge ayrıca onay ister.

**Uygulama:** `lib/fleet-sim.ts` (`ADALAR_PLACES`, `adalarTerrain`, `ADALAR_ROUTES`, `adalarPose`), `World.tsx` (Adalar kara/deniz, iskele ve ada etiketleri, binalar), `Scene.tsx` (`region`, kamera, gemi ölçeği ×4 genel görünümde), `FleetView.tsx` (Bölge seçici), `fleet.region*` metinleri. Gemi içi salon aynıdır.

**Doğrulama (çalıştırıldı):** typecheck 11/11, lint, build 8/8, web birim 15/15 (tüm rota bacakları su üstünde, 8 hat da kullanılıyor, gemiler suda). Tarayıcıda sahte 8 gemiyle elle görüldü. **Çalıştırılmadı:** Playwright, gerçek veri, gerçek GPU/mobil, Adalar'da gemiye giriş uçuşu (yalnız Boğaz'da görüldü).
**Bilinen sınırlar:** Gemiler uzaktan küçüktür (×4 ölçek, etiketle bulunur); kıyı çizgisi slayttan elle yaklaşıklanmıştır; Marmara kıyıları (Bakırköy vb.) basitleştirilmiştir.
