# ioBroker Alarm Control

**Alarm Control** ist ein einfacher, flexibel konfigurierbarer Alarmanlagen-Adapter für ioBroker.

> Alarm Control ist keine zertifizierte Einbruchmeldeanlage und ersetzt keine VdS-/EN-konforme Sicherheitsanlage.

## Funktionen der Version 0.1.0

- Melder aus beliebigen ioBroker-Datenpunkten
- Bedingungen: `true`, `false`, gleich, ungleich, größer, kleiner, zwischen, enthält und Regex
- Verzögerte Auslösung zur Unterdrückung kurzer Fehlimpulse
- Meldegruppen
- Sicherungsbereiche
- Modi: unscharf, intern scharf, extern scharf und Urlaub
- Ein- und Austrittsverzögerung
- Umgang mit offenen Meldern: Scharfschaltung blockieren, umgehen oder zulassen
- Residents-/Anwesenheitsintegration
- Telegram-Benachrichtigung
- Asterisk-Ansteuerung über Datenpunkt oder `sendTo`
- Aktoren für Sirene, Licht, Szene und freie Datenpunkte
- Freie Ein-/Aus-Werte einschließlich Boolean, Zahl, String und JSON
- Begrenzte Sirenenlaufzeit
- Alarmhistorie
- Panik- und Testalarm
- Steuerung über ioBroker-Datenpunkte

## Installation über GitHub

Repository als `ioBroker.alarm-control` anlegen und alle Dateien aus der ZIP-Datei in das Stammverzeichnis hochladen.

Danach auf dem ioBroker-Host:

```bash
iobroker url https://github.com/ToSchu41/ioBroker.alarm-control --host <HOSTNAME>
iobroker add alarm-control
```

Alternativ kann in der Admin-Oberfläche „Adapter aus eigener URL installieren“ verwendet werden.

## Konfigurationsmodell

```text
Datenpunkt → Melder → Meldegruppe → Sicherungsbereich → Alarmaktion
```

### Beispiel

1. Melder `window_kitchen` liest `zigbee.0.kitchen_window.opened`.
2. Er gehört zur Meldegruppe `perimeter`.
3. Die Meldegruppe ist im Sicherungsbereich `house` enthalten.
4. Der Bereich ist in `internal`, `external` und `vacation` aktiv.
5. Der Bereich führt die Aktionen `telegram_alarm`, `siren` und `outside_light` aus.

## Melderbedingungen

| Bedingung | Bedeutung |
|---|---|
| `true` | Boolean true, 1 oder String true |
| `false` | Boolean false, 0 oder String false |
| `eq` | Wert ist gleich |
| `neq` | Wert ist ungleich |
| `gt` | größer |
| `lt` | kleiner |
| `between` | zwischen Min und Max |
| `contains` | String enthält |
| `regex` | regulärer Ausdruck trifft zu |

## Offene Melder beim Scharfschalten

- `block`: Scharfschaltung wird verhindert.
- `bypass`: Melder wird beim Prüfen als umgangen angezeigt.
- `allow`: Scharfschaltung wird trotz offenem Melder zugelassen.

## Residents

Alarm Control liest genau einen zentralen Anwesenheits-Datenpunkt. Die Werte für `home`, `away` und `vacation` können frei zugeordnet werden.

Das automatische Unscharfschalten bei Anwesenheit ist standardmäßig deaktiviert, weil ein fehlerhaftes Geofencing-Signal die Anlage sonst ungewollt deaktivieren könnte.

## Telegram

Eine Aktion vom Typ `telegram` sendet über:

```javascript
sendTo("telegram.0", "send", {
  text: "ALARM: Fenster Küche / Haus"
});
```

Optional kann ein Telegram-Empfänger angegeben werden.

## Asterisk

Da Asterisk-Adapter und individuelle Dialplans unterschiedliche Schnittstellen verwenden können, gibt es zwei Varianten:

1. **Datenpunkt schreiben:** Ein konfigurierter Datenpunkt wird auf den gewünschten Wert gesetzt.
2. **sendTo:** Instanz, Befehl und JSON-Payload werden frei angegeben.

Damit ist die erste Version nicht an eine bestimmte Asterisk-Implementierung gebunden.

## Aktionswerte

Für Sirenen, Lampen, Szenen und freie Datenpunkte kann der Datentyp gewählt werden:

- Boolean
- Zahl
- String
- JSON

Bei `Aus nach s` wird nach Ablauf der Zeit immer der konfigurierte **Aus-Wert** geschrieben. Es wird nicht automatisch angenommen, dass `0` oder `false` richtig ist.

## Datenpunkte

```text
alarm-control.0
├── control
│   ├── armInternal
│   ├── armExternal
│   ├── armVacation
│   ├── disarm
│   ├── acknowledge
│   ├── reset
│   ├── panic
│   ├── testAlarm
│   └── silenceSiren
├── status
│   ├── mode
│   ├── modeText
│   ├── armed
│   ├── alarm
│   ├── alarmArea
│   ├── alarmGroup
│   ├── alarmDetector
│   ├── alarmTime
│   ├── entryDelayActive
│   ├── exitDelayActive
│   ├── openDetectors
│   ├── bypassedDetectors
│   ├── presence
│   ├── history
│   ├── lastEvent
│   └── lastError
└── info
    └── connection
```

## Sicherheitshinweise

- Sirene zunächst mit einer Lampe oder einem Testdatenpunkt erproben.
- Maximale Sirenenlaufzeit konfigurieren.
- Automatisches Unscharfschalten über Residents nur aktivieren, wenn die Anwesenheitserkennung zuverlässig genug ist.
- Telefon- und Telegram-Aktionen regelmäßig testen.
- ioBroker, Netzwerk und Stromversorgung gegen Ausfall absichern.
- Für versicherungsrelevanten Einbruchschutz eine zertifizierte Anlage verwenden.

## Changelog

### 0.1.0

- Erste Version
- Melder, Gruppen, Bereiche und Aktionen
- Residents, Telegram und Asterisk
- Sirenen-, Licht-, Szenen- und Datenpunktaktionen
- Verzögerungen, Historie und Testfunktionen

## Lizenz

MIT
