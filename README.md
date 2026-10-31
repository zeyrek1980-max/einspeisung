# Strombilanz (ohne PC)

Handy-Seite, die den verkauften Solarstrom laut Einspeisezähler zeigt, in kWh und Euro.

## So funktioniert es

- Ein geplanter GitHub-Lauf (`.github/workflows/update.yml`) holt alle 15 Minuten die Viertelstundenwerte der
  Einspeisung aus dem Westnetz-Portal MeDaCo (`scripts/update.js`, `portal.js`).
- Die Werte werden zu Stundensummen verdichtet, mit AES-256-GCM verschlüsselt und als `site/data.enc.json`
  über GitHub Pages veröffentlicht. Ohne den Zugangscode sind die Zahlen nicht lesbar.
- Die Seite (`site/index.html`) fragt den Zugangscode einmal ab, entschlüsselt die Zahlen im Browser und rechnet
  Tag, Monat und Zeitraum seit dem Start der Direktvermarktung aus.

## Einrichtung

Unter *Settings → Secrets and variables → Actions* drei Secrets anlegen:

| Name | Inhalt |
|---|---|
| `MEDACO_USER` | Benutzername oder E-Mail-Adresse im MeDaCo-Portal |
| `MEDACO_PASSWORD` | Passwort im MeDaCo-Portal |
| `DATA_KEY` | frei gewählter Zugangscode für die Handy-Seite |

Unter *Settings → Pages* als Quelle „GitHub Actions“ wählen. Dann den Workflow einmal von Hand starten.

## Live-Werte

Die Handy-Seite zeigt Erzeugung, Verbrauch, Einspeisung und Batteriestand live. Sie fragt dafür alle 5 Sekunden
`my-api.sonnen.de/v1/sites/<id>/live-state` ab, mit einem Zugriffsschlüssel, der 2 Stunden gilt.

- Der Workflow erneuert den Schlüssel (`scripts/sonnen.js`) und legt ihn verschlüsselt (Zugangscode) in
  `data.enc.json` ab. sonnen tauscht bei jeder Erneuerung den Erneuerungsschlüssel aus. Der aktuelle Stand liegt
  verschlüsselt (Geheimnis `TOKEN_KEY`) im Zweig `state` und wird nach jeder Erneuerung sofort gesichert.
- Zusätzliche Secrets: `SONNEN_SEED` (JSON mit `refreshToken` und `siteId`, nur für den ersten Start oder einen
  Neustart der Kette) und `TOKEN_KEY` (Code für den Zustand).
- Fällt Live aus, zeigt die Seite weiter die letzte Viertelstunde vom Zähler. Ist die Kette gerissen (Fehler
  „sonnen lehnt die Erneuerung ab“ im Lauf), muss `SONNEN_SEED` neu gesetzt und der Zweig `state` gelöscht werden.
- Es darf nur eine Stelle den Erneuerungsschlüssel benutzen. Wer sich mit demselben Schlüssel sonst irgendwo
  anmeldet, bringt die Kette durcheinander.

## Verkauft und bezogen

Die Seite zeigt zwei Richtungen, umschaltbar oben: **Verkauft** (Einspeisung ins Netz, Linie 1-1:2.29.0) und
**Eingekauft** (Strom aus dem Netz, Linie 1-1:1.29.0). Unter dem Diagramm steht die Bilanz seit dem Startdatum:
Erlös aus dem Verkauf minus die Kosten für den Bezug.

## Abschlag, Grundpreis und Gebühren

In `tarif.json` unter `monthly` stehen die monatlichen Beträge. Jede Liste kann mehrere Einträge mit eigenem
`from`-Datum haben, falls sich ein Betrag ändert. Ein angefangener Monat zählt voll.

- `abschlag`: Abschlag für den Strom. Die Seite vergleicht ihn ab dem ersten Abschlagsmonat mit den Stromkosten
  laut Zähler (Arbeitspreis mal bezogene kWh plus Grundpreis) und zeigt ein voraussichtliches Guthaben oder eine
  Nachzahlung.
- `grundpreis`: monatlicher Grundpreis des Stromvertrags.
- `gebuehren`: weitere monatliche Gebühren, z. B. die Direktvermarktung. Sie fließen in die Bilanz seit
  Startdatum ein.

Zum Ausprobieren künftiger Monate die Seite mit `?heute=2026-11-20` öffnen.

## Preise ändern

Die Sätze stehen in `tarif.json`: `rates` ist die Vergütung für verkauften Strom, `buyRates` der Strompreis für
bezogenen Strom (ohne Grundgebühr). `startDate` ist der erste Tag, der mitgerechnet wird. Ein neuer Satz bekommt
ein eigenes `from`-Datum, ältere Tage behalten ihren alten Satz.

## Dauerbetrieb

Die Seite soll ohne Zutun aktuell bleiben, auch wenn monatelang niemand nachsieht.

- **Kette:** Jeder Lauf wartet am Ende gut 13 Minuten (Job `weiter`) und startet den nächsten per
  `workflow_dispatch`. Der GitHub-Zeitplan allein war unzuverlässig: Er lief bei diesem Repository anfangs gar nicht.
  Läuft schon ein neuerer Lauf, setzt nur dieser die Kette fort, es entsteht nie eine zweite.
- **Zeitplan als Reserve:** `cron` auf den Minuten 4, 19, 34 und 49 holt die Kette zurück, falls sie einmal abreißt.
  Anhalten: `gh workflow disable update.yml`.
- **Portal fällt aus:** Dann bleibt der zuletzt veröffentlichte Stand online (die Seite meldet „nicht aktuell“) und die
  Live-Werte laufen weiter. Nach abgelehnter Anmeldung (falsches oder geändertes Passwort) pausiert der Abruf
  6 Stunden, damit das Konto nicht gesperrt wird. Danach neues Passwort im Secret `MEDACO_PASSWORD` hinterlegen.
- **Inaktivität:** GitHub schaltet Zeitpläne in öffentlichen Repositories nach 60 Tagen ohne Aktivität ab. Der Workflow
  legt deshalb nach 40 Tagen einen kleinen Commit an.

## Grenzen

- Das Portal liefert die Werte mit etwa 15 bis 30 Minuten Verzögerung. Live-Leistung kommt separat von sonnen.
- Reißt die Kette ab und der Zeitplan fällt ebenfalls aus (z. B. bei einer GitHub-Störung), steht die Seite, bis jemand
  `gh workflow run update.yml` ausführt oder in GitHub unter *Actions* den Lauf von Hand startet.
