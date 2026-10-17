# ioBroker.alarm-control

Erste Entwicklungsversion (0.1.0) einer Alarmsteuerung für vorhandene ioBroker-Datenpunkte, insbesondere KNX-Bewegungsmelder und Fensterkontakte.

## Funktionen

- Unabhängige Sicherungsbereiche; Haus und Garage sind vorbereitet, weitere Bereiche können ergänzt werden.
- Je Bereich Innen- und Außenzone. **Anwesend** überwacht außen, **Abwesend** beide Zonen, **Unscharf** beendet die Überwachung und setzt den Alarm zurück.
- Pro Sensor: Aktivwert (boolesch oder 0/1), Mindestaktivdauer, Anzahl Aktivierungen innerhalb eines Zeitfensters, Eingangsverzögerung und Scharfschaltblockade bei offenem Kontakt.
- Ausgangsverzögerung pro Bereich; offene oder unbekannte relevante Sensoren werden vor und nach dem Countdown geprüft.
- Zwei vorbereitete Innensirenen, beliebig erweiterbar. Bereichszuordnung oder gemeinsam für alle Bereiche, Kontaktinvertierung und begrenzte Laufzeit.
- Telegram und Asterisk separat oder gemeinsam. Telefonnummern einzeln aktivieren und Bereichen zuordnen.
- Konfiguration im ioBroker Admin über Tabellen und Datenpunktauswahl.

## Installation zum Testen

Voraussetzungen: Node.js >=20, js-controller >=6.0.11, Admin >=7.6.17. Der KNX-Adapter sowie die gewünschten Benachrichtigungsadapter müssen bereits funktionieren.

Nach Bereitstellung im Repository auf dem ioBroker-Rechner:

```sh
iobroker url https://github.com/ToSchu41/ioBroker.alarm-control
iobroker add alarm-control
```

Alternativ im Admin die benutzerdefinierte Installation über die GitHub-URL verwenden. Diese Version ist noch nicht im offiziellen Adapterverzeichnis oder auf npm veröffentlicht.

## Einrichtung

1. In **Bereiche** Namen, IDs und Ausgangsverzögerung eintragen. IDs bestehen aus kleinen Buchstaben, Ziffern und Unterstrichen und beginnen mit einem Buchstaben. Sie müssen pro Tabelle eindeutig sein. Bereichs-IDs nach der Einrichtung unverändert lassen.
2. In **Sensoren** pro Melder eine Zeile anlegen und den bestehenden KNX-Datenpunkt auswählen. Als Bereich `haus` oder `garage` eintragen und Innen-/Außenzone auswählen. `true`/`false` sind boolesch, `1`/`0` sind Zahlen; Textwerte werden als unbekannt behandelt.
3. Fensterkontakte: üblicherweise Außenzone, eine Aktivierung, keine Mindestdauer, Scharfschaltblockade aktiv. Bewegungsmelder: üblicherweise Innenzone; Scharfschaltblockade gegebenenfalls deaktivieren.
4. In **Sirenen** die beiden schreibbaren booleschen KNX-Schaltkontakte auswählen und aktivieren. `*` ordnet eine Sirene allen Bereichen zu. Die Laufzeit beträgt zunächst 120 Sekunden.
5. In **Benachrichtigungen** die vorhandenen Instanzen eintragen und Kanäle aktivieren. Telefonnummern in der Empfängertabelle einzeln aktivieren. `*` bedeutet alle Bereiche. Telegram-Benutzer leer lassen bedeutet Versand an die im Telegram-Adapter vorgesehenen Benutzer.
6. Speichern, anschließend die Bedien-Datenpunkte in VIS, Blockly oder eine vorhandene Bedienung einbinden.

Beispiel für einen Bewegungsmelder: `hits=2`, `windowSeconds=30`, `holdSeconds=0` löst nach zwei neuen Aktivierungen innerhalb von 30 Sekunden aus. Wiederholte KNX-Telegramme mit unverändertem Aktivwert zählen nicht. Zwischen zwei Aktivierungen muss der Sensor in Ruhelage zurückkehren. Ein KNX-Melder mit eigener langer Nachlaufzeit eignet sich deshalb möglicherweise nicht für diese Einstellung.

`holdSeconds=2` verlangt einen durchgehend aktiven Sensor für zwei Sekunden. `entrySeconds=20` erlaubt anschließend 20 Sekunden zum Unscharfschalten. Nach Beginn dieser Eingangsverzögerung verhindert das Schließen eines Kontakts den Alarm nicht mehr. Weitere Meldungen verlängern die Frist nicht; ein unverzögerter Sensor löst sofort aus.

## Einfache Bedienung

Für Haus, analog für Garage:

| Datenpunkt unter `alarm-control.0` | Funktion |
| --- | --- |
| `areas.haus.mode` | `disarmed`, `home` oder `away` schreiben, mit `ack=false` |
| `areas.haus.status` | `disarmed`, `exit`, `armed`, `entry` oder `alarm` |
| `areas.haus.alarm` | Gespeicherter Alarm |
| `areas.haus.reason` | Auslösender Sensor oder Abbruchgrund |
| `areas.haus.blockedSensors` | JSON-Liste blockierender/offener/unbekannter Sensoren |
| `areas.haus.silence` | `true` schreiben: Sirenenanforderung dieses Bereichs beenden |
| `areas.haus.lastAlarm` | Letzter Alarm als JSON, bleibt nach Unscharf erhalten |
| `info.lastError` | Letzter Bedienungs-, Ausgangs- oder Benachrichtigungsfehler |
| `info.lastEvent` | Letztes Alarmereignis als JSON |
| `info.connection` | Adapterinitialisierung erfolgreich; keine KNX-Verbindungsüberwachung |

Für VIS genügen pro Bereich drei Modustasten, eine Statusanzeige und eine Taste „Sirene aus“. Ein direkter Wechsel zwischen Anwesend und Abwesend verlangt zunächst Unscharf. Ein blockierter Befehl setzt `mode` auf den tatsächlichen Modus zurück und schreibt den Grund nach `info.lastError`.

Bei einer gemeinsam genutzten Sirene reicht „Sirene aus“ für Haus nicht aus, wenn Garage ebenfalls eine aktive Sirenenanforderung hat. Nach Ablauf der Sirenenlaufzeit bleibt der Alarm gespeichert. Ein neuer Alarmzyklus beginnt erst nach Unscharf und erneutem Scharfschalten.

## Verhalten und Grenzen der Entwicklungsversion

- Bei jedem Adapterstart werden alle Bereiche **unscharf** gesetzt und konfigurierte Sirenen ausgeschaltet. Scharfschaltung wird nicht automatisch wiederhergestellt.
- Ungültige oder nicht vorhandene Sensorwerte blockieren die Scharfschaltung. Während der Überwachung erscheinen sie in `blockedSensors`; sie erzeugen derzeit keinen eigenen Sabotagealarm. Unveränderte, aber veraltete KNX-Werte werden noch nicht erkannt.
- Die Software schaltet Sirenen zeitlich aus. Bei Stromausfall oder Prozessabsturz kann sie keinen Ausschaltbefehl senden; eine gegebenenfalls nötige Abschaltung muss zusätzlich im Aktor eingestellt werden.
- Telefonanrufe werden für alle aktivierten passenden Nummern beim Asterisk-Adapter angefordert. Es gibt keine Anrufannahmeerkennung, Quittierung oder Eskalationskette. Bereits angeforderte Nachrichten/Anrufe werden durch Unscharf nicht zurückgerufen.
- Keine eigene VIS-Oberfläche, PIN-Prüfung oder direkte KNX-Tasterzuordnung enthalten. Berechtigungen der Bedienung müssen in der vorhandenen ioBroker-Installation eingerichtet werden.
- Reale KNX-Geräte, Admin-Darstellung und Nachrichtenversand müssen in einer Testinstanz geprüft werden; die automatisierten Tests verwenden simulierte Zeit und eine Adaptergrenzen-Attrappe.

## Entwicklung und Prüfung

```sh
npm install
npm run check
npm test
```

Die Tests prüfen Zustandswechsel, Zonentrennung, Zeitlogiken, Scharfschaltblockaden, Alarmrücksetzung, gemeinsame Sirenen, Kontaktinvertierung, Teilfehler und Benachrichtigungspayloads. GitHub Actions führt Syntaxprüfung und Tests unter Node 20, 22 und 24 aus.

## Schnittstellenquellen

- [ioBroker jsonConfig](https://github.com/ioBroker/json-config): Admin-Konfiguration.
- [Asterisk-Dokumentation](https://github.com/schmupu/ioBroker.asterisk): `sendTo(instance, 'dial', { telnr, text })`.
- [Telegram-Dokumentation](https://github.com/iobroker-community-adapters/ioBroker.telegram/blob/master/docs/en/README.md): `sendTo(instance, 'send', { text, user })`.

## Changelog

### 0.1.0

Erste Entwicklungsversion mit Bereichssteuerung, Sensorlogiken, Sirenen, Telegram und Asterisk.

## Lizenz

MIT, Copyright (c) 2026 ToSchu41.
