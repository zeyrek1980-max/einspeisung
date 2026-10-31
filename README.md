# Einspeisung (ohne PC)

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

## Vergütung ändern

Die Sätze stehen in `tarif.json`. `startDate` ist der erste Tag, der mitgerechnet wird.

## Grenzen

- Das Portal liefert die Werte mit etwa 15 bis 30 Minuten Verzögerung. Live-Leistung gibt es hier nicht.
- GitHub verzögert geplante Läufe manchmal um einige Minuten und schaltet sie in öffentlichen Repositories nach
  60 Tagen ohne Aktivität ab. Der Workflow legt deshalb gelegentlich einen kleinen Commit an.
- Meldet das Portal die Anmeldung als abgelehnt, bricht der Lauf ab und die Seite zeigt „nicht aktuell“.
