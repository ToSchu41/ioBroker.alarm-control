# ioBroker.alarm-control

Alarmsteuerung für vorhandene ioBroker-Datenpunkte, insbesondere KNX-Bewegungsmelder und Fensterkontakte. Entwicklungsversion **0.2.0**. Bedienung über VIS / ioBroker-Datenpunkte, Telefonie über den vorhandenen Adapter **asterisk.0 (2.0.3)**.

## Funktionen

- Unabhängige Sicherungsbereiche, vorbereitet für Haus und Garage, jeweils mit Innen- und Außenzone.
- **Anwesend** überwacht außen, **Abwesend** beide Zonen, **Unscharf** beendet die Einbruchsüberwachung.
- Sensorlogiken: Mindestaktivdauer, mehrere Aktivierungen im Zeitfenster, Eingangsverzögerung, Scharfschaltblockade bei offenem Kontakt. Ausgangsverzögerung pro Bereich.
- Optionale Sabotagekontakte mit sofortiger Überwachung rund um die Uhr, unabhängig vom Scharfschaltmodus.
- Sensorchannels mit dauerhaft gespeichertem `enable`, Status, Sabotage- und Fehleranzeige.
- Bereichsbezogene oder gemeinsam genutzte Sirenen mit Invertierung und Laufzeitbegrenzung.
- Telegram-Vorlagen für Alarm, Sabotage, Panik, Aktivierung, Deaktivierung, blockierte Aktivierung und weitere Ereignisse.
- Anrufe an alle aktivierten passenden Telefonnummern. Doppelt eingetragene identische Nummern werden pro Ereignis nur einmal angefordert.
- Panik aus VIS oder über einen optionalen externen Datenpunkt, mit frei wählbarer Szene und optionalen Sirenen.
- Testnachricht und Testanruf direkt in den Benachrichtigungseinstellungen.
- Bereitschaftsanzeige, Liste ausgeblendeter Sensoren und begrenztes, über Neustarts erhaltenes Ereignisprotokoll.

## Voraussetzungen und Erstinstallation

Node.js >=20, js-controller >=6.0.11, Admin >=7.6.17. KNX-, Telegram- und Asterisk-Adapter müssen für die gewünschten Funktionen bereits eingerichtet sein. Für die Panikszene wird der Szenenadapter benötigt.

Nur für eine **neue** Installation:

```sh
iobroker url https://github.com/ToSchu41/ioBroker.alarm-control
iobroker add alarm-control
```

Die Version ist auf GitHub bereitgestellt, noch nicht im offiziellen Adapterverzeichnis oder auf npm veröffentlicht.

## Bestehende Installation aktualisieren

Eine vorhandene Instanz wird weiterverwendet. Weder Adapter noch Instanz löschen und **kein erneutes `iobroker add`** ausführen.

1. Bereiche unscharf schalten und ein ioBroker-Backup anlegen.
2. Im Terminal des ioBroker-Rechners ausführen (bei Docker innerhalb des ioBroker-Containers):

```sh
iobroker backup
iobroker stop alarm-control.0
iobroker url https://github.com/ToSchu41/ioBroker.alarm-control
iobroker upload alarm-control
iobroker start alarm-control.0
iobroker version alarm-control
```

Bei mehreren Instanzen alle betroffenen Instanzen vor dem Update stoppen und anschließend wieder starten. Nach einem fehlgeschlagenen Installationsschritt den Fehler beheben, bevor die Instanz gestartet wird. Die Versionsausgabe sollte `0.2.0` zeigen.

3. Admin im Browser vollständig neu laden und die Instanzeinstellungen öffnen. Neue Optionen kontrollieren und speichern, danach den Adapterneustart abwarten.
4. Sensorstatus und Sabotagekontakte prüfen; anschließend über **Benachrichtigungen** die Testnachricht und Testanrufe auslösen.
5. Gewünschte Bereiche wieder scharfschalten.

Bestehende Bereichs-, Sensor-, Sirenen- und Empfängertabellen bleiben erhalten. Die Laufzeit ergänzt fehlende neue Optionen mit Standardwerten, ohne die vorhandene Konfiguration zu ersetzen. Neue Sensorobjekte werden automatisch angelegt. Gespeicherte `enable`-Werte bleiben erhalten. Bereichs- und Sensor-IDs nicht ändern, wenn VIS-Verknüpfungen bestehen bleiben sollen.

**Nach jedem Adapterstart ist die Einbruchsüberwachung unscharf.** Ein beim Start aktiver Sabotagekontakt oder externer Panikeingang löst trotzdem unmittelbar aus. Während des Updates läuft diese Softwareüberwachung nicht.

Alternativ im Admin die benutzerdefinierte Installation über die GitHub-URL für den bereits installierten Adapter verwenden, anschließend gegebenenfalls **Upload** ausführen und die vorhandene Instanz starten. Die CLI-Variante oben ist unabhängig von der Anordnung der Schaltflächen in der Admin-Version.

## Einrichtung

1. **Bereiche:** Namen, IDs und Ausgangsverzögerung eintragen. IDs beginnen mit einem kleinen Buchstaben und enthalten nur kleine Buchstaben, Ziffern und Unterstriche. Sie müssen pro Tabelle eindeutig sein.
2. **Sensoren:** Bestehenden KNX-Datenpunkt auswählen, Bereichs-ID und Zone angeben. `true`/`false` sind boolesch, `1`/`0` sind Zahlen. Andere Werte oder abweichende Datentypen gelten als unbekannt. Der Tabellenwert „Anfangswert enable“ gilt für neu angelegte Sensorobjekte; anschließend steuert das Objekt `enable` den Sensor.
3. **Sabotagekontakt:** Optional einen separaten Datenpunkt und dessen Sabotage-Aktivwert auswählen. Der Aktivwert bezeichnet den Fehler-/Sabotagefall, nicht den intakten Kontakt.
4. **Sirenen:** Schreibbare boolesche KNX-Schaltkontakte auswählen und aktivieren. Bereich `*` bedeutet alle Bereiche. Anfangs sind 120 Sekunden Laufzeit eingestellt.
5. **Benachrichtigungen:** Vorhandene Instanzen und Empfänger eintragen. `*` beim Telefonempfänger bedeutet alle Bereiche. Telegram-Benutzer leer bedeutet die im Telegram-Adapter vorgesehenen Benutzer. Alle aktivierten passenden Telefonnummern werden angefordert.
6. **Nachrichtentexte:** Texte mit den unten beschriebenen Platzhaltern anpassen. Informationsmeldungen werden ausschließlich über Telegram gesendet. Telefonanrufe erfolgen bei Einbruchalarm, Sabotage, Panik und beim bewussten Testanruf.
7. **Panik und Sabotage:** Optional Szene und externen Panikeingang auswählen. Sirenen für Panik und Sabotage sind getrennt einstellbar, zunächst jeweils eingeschaltet. Ereignisanzahl und Zeitzone lassen sich hier ebenfalls ändern.
8. Speichern und Adapterneustart abwarten, dann die Testschaltflächen verwenden und die VIS-Bedienung einrichten.

## Sensorlogiken

Fensterkontakte gehören üblicherweise zur Außenzone, mit einer Aktivierung und Scharfschaltblockade bei offenem Kontakt. Bewegungsmelder gehören häufig zur Innenzone; ihre Scharfschaltblockade kann deaktiviert werden.

`hits=2`, `windowSeconds=30`, `holdSeconds=0` verlangt zwei neue Aktivierungen innerhalb von 30 Sekunden. Unveränderte KNX-Telegramme zählen nicht. Zwischen Aktivierungen muss der Sensor in Ruhelage zurückkehren. Ein Melder mit langer eigener Nachlaufzeit eignet sich möglicherweise nicht für diese Einstellung.

`holdSeconds=2` verlangt zwei Sekunden durchgehende Aktivität. `entrySeconds=20` erlaubt nach erfüllter Sensorlogik 20 Sekunden zum Unscharfschalten. Das Schließen des Kontakts hebt die laufende Eingangsverzögerung nicht auf. Weitere Meldungen verlängern sie nicht. Jeder qualifizierte Sensor behält seine erste Frist; die kürzeste Frist entscheidet. Ein Sensor ohne Eingangsverzögerung löst sofort aus.

`enable=false` blendet die Einbruchsauswertung dieses Sensors aus, entfernt seine Zählungen und Fristen und zeigt `status=disable`. Fristen anderer Sensoren bleiben bestehen. Ein bereits gespeicherter Alarm wird dadurch nicht gelöscht. Beim erneuten Aktivieren wird ein bereits aktiver Sensor im scharfen Bereich sofort anhand seiner konfigurierten Logik ausgewertet. Scharfschalten ohne einen einzigen aktiven Sensor für den gewählten Modus wird abgelehnt.

## Sabotageverhalten und Rücksetzung

Sabotage wird **auch bei unscharfer Anlage und bei `enable=false`** überwacht. Mindestaktivdauer, Mehrfachauslösung und Ein-/Ausgangsverzögerungen gelten für die Einbruchsmeldung, nicht für Sabotage. Ein Sabotagealarm wird sofort gespeichert, gemeldet und schaltet die zugeordneten Sirenen ein, sofern dies aktiviert ist. Pro Bereich wird bis zur Rücksetzung ein Sabotagealarm ausgelöst; ein bestehender Einbruchalarm kann zusätzlich zu einem Sabotagealarm eskalieren.

Ein fehlender, ungültiger oder qualitativ fehlerhafter Sabotagewert erscheint als Fehler und verhindert die Scharfschaltung, auch wenn die Einbruchsauswertung deaktiviert oder die Innenzone im Anwesend-Modus ausgeblendet ist. Ein unbekannter Wert allein löst keinen Sabotagealarm aus.

Ein aktiver Sabotagekontakt verhindert die Rücksetzung. Auch ein unbekannter Sabotagekontakt verhindert das Löschen eines gespeicherten Sabotagealarms. Nach Wiederherstellung bleibt der Alarm gespeichert, bis der Bereich unscharf geschaltet oder im bereits unscharfen Zustand `areas.<ID>.reset=true` geschrieben wird. Die Sirene kann zuvor mit `silence=true` stummgeschaltet werden.

## Nachrichtenvorlagen

Für jeden Nachrichtentyp gibt es eine eigene Vorlage. Texte werden als Klartext gesendet. Unbekannte Platzhalternamen werden bei der Konfigurationsprüfung zurückgewiesen.

| Platzhalter | Bedeutung |
| --- | --- |
| `{sensor_name}` / `{sensor_id}` | Auslösender Sensor; leer bei Ereignissen ohne einzelnen Sensor |
| `{bereich}` / `{bereich_id}` | Bereichsname / ID, bei Panik oder Test „Alle Bereiche“ / `*` |
| `{zustand}` | Zustand, z. B. Alarm, Scharf, Unscharf oder Deaktiviert |
| `{modus}` | Unscharf, Anwesend oder Abwesend; bei blockierter Aktivierung der angeforderte Modus |
| `{ereignis}` | Ereignisart, z. B. Einbruchalarm, Sabotagealarm oder Aktivierung verhindert |
| `{grund}` | Fehler-/Abbruchgrund, falls vorhanden |
| `{offene_sensoren}` | Blockierende offene, aktive oder unbekannte Kontakte samt Ursache; sonst „keine“ |
| `{deaktivierte_sensoren}` | Sensoren mit ausgeblendeter Einbruchsauswertung im betroffenen Bereich; sonst „keine“ |
| `{zone}` | Innen oder Außen; leer ohne einzelnen Sensor |
| `{zeit}` / `{datum}` | Datum und Uhrzeit / Datum in der eingestellten Zeitzone |
| `{timestamp}` | ISO-Zeitstempel in UTC |
| `{instanz}` | Adapterinstanz, z. B. `alarm-control.0` |

Beispiele:

```text
Alarm: {sensor_name} in {bereich} ({zone}) – {zustand} um {zeit}
{bereich}: Aktivierung verhindert. {offene_sensoren}
{bereich} ist jetzt {modus}. Ausgeblendete Sensoren: {deaktivierte_sensoren}
```

„Aktiviert“ wird erst nach erfolgreichem Ablauf der Ausgangsverzögerung gemeldet. Deren Beginn kann optional zusätzlich gemeldet werden. Verhindert ein offener Kontakt das Scharfschalten sofort oder am Ende des Countdowns, nennt die standardmäßige Telegram-Meldung die betroffenen Sensoren. Die Vorlagen hierfür können ebenfalls frei angepasst werden.

## Datenpunkte für VIS

Alle Angaben relativ zu `alarm-control.0`. Schreibbefehle mit **`ack=false`** senden.

| Datenpunkt | Funktion |
| --- | --- |
| `areas.haus.mode` | `disarmed`, `home` oder `away` schreiben; Garage entsprechend |
| `areas.haus.status` | `disarmed`, `exit`, `armed`, `entry` oder `alarm` |
| `areas.haus.alarm` | Gespeicherter Bereichsalarm |
| `areas.haus.tamper` | Mindestens ein Sabotagekontakt aktuell aktiv |
| `areas.haus.ready` | Bereit für den aktuellen Modus, im unscharfen Zustand für Abwesend; kein gespeicherter Alarm |
| `areas.haus.reason` | Alarmursache / Abbruchgrund |
| `areas.haus.blockedSensors` | JSON-Liste blockierender Sensoren samt Ursache |
| `areas.haus.disabledSensors` | JSON-Liste ausgeblendeter Sensoren |
| `areas.haus.silence` | `true`: Sirenenanforderungen des Bereichs beenden, Alarm bleibt gespeichert |
| `areas.haus.reset` | `true`: Alarm im unscharfen Zustand zurücksetzen, sofern Sabotagekontakte intakt |
| `areas.haus.lastAlarm` | Letzter Bereichsalarm als JSON; bleibt nach Rücksetzung erhalten |
| `areas.haus.sensors.<Sensor-ID>.enable` | Einbruchsauswertung aktivieren/deaktivieren; bleibt über Neustarts erhalten |
| `areas.haus.sensors.<Sensor-ID>.status` | `normal`, `active`, `pending`, `alarm`, `tamper`, `unknown` oder `disable` |
| `areas.haus.sensors.<Sensor-ID>.tamper` | Sabotagekontakt aktuell aktiv; wird auch bei `disable` angezeigt |
| `areas.haus.sensors.<Sensor-ID>.fault` | Unbekannter relevanter Sensorwert / Sabotagewert |
| `panic.trigger` | `true`: Panik auslösen; wird automatisch auf `false` bestätigt |
| `panic.active` | Panik gespeichert |
| `panic.reset` | `true`: Panik und zugehörige Sirenenanforderungen zurücksetzen |
| `info.lastError` | Letzter Bedienungs-, Ausgangs- oder Benachrichtigungsfehler |
| `info.lastEvent` | Letztes Ereignis als JSON, einschließlich Informationsmeldungen |
| `info.eventHistory` | Ereignisprotokoll als JSON-Array, älteste zuerst; standardmäßig maximal 100 Einträge |
| `info.testResult` | Ergebnis des letzten Benachrichtigungstests |
| `info.connection` | Initialisierung erfolgreich; keine KNX-Verbindungsüberwachung |

Ein direkter Wechsel zwischen Anwesend und Abwesend verlangt zunächst Unscharf. Blockierte Befehle setzen `mode` auf den tatsächlichen Modus zurück und schreiben den Fehler nach `info.lastError`.

Bei gemeinsam genutzten Sirenen bleiben andere Bereichs- und Panikanforderungen wirksam. Nach Ablauf der Sirenenlaufzeit bleibt der Alarm gespeichert. Eine normale Unscharfschaltung löscht keinen globalen Panikalarm.

## Panik und Szene

`panic.trigger=true` löst unabhängig vom Bereichsmodus aus. Telegram und alle aktivierten Telefonnummern werden benachrichtigt, unabhängig von deren Bereichszuordnung. Die konfigurierte Szene wird einmalig mit `true` und `ack=false` aktiviert; bei eingeschalteter Panik-Sirenenoption werden alle aktivierten Sirenen angefordert.

Für die Szene den schreibbaren booleschen Aktivierungsdatenpunkt des Szenenadapters wählen, beispielsweise `scene.0.Panik`. Dort kann etwa „Licht an“ oder eine andere gewünschte Aktion hinterlegt werden. Der Adapter verändert die Szenendefinition nicht.

Panik bleibt bis `panic.reset=true` gespeichert. Wiederholte Auslösungen starten währenddessen keine weiteren Anruf-/Szenenaktionen. Ein konfigurierter externer Panikeingang muss zum Rücksetzen nachweislich in Ruhelage sein. Das Rücksetzen macht die Aktionen der Szene **nicht rückgängig** und storniert keine bereits angeforderten Anrufe.

## Testnachricht und Testanruf

Unter **Benachrichtigungen** zuerst speichern und den Neustart abwarten. Die Schaltflächen benutzen die gespeicherte Konfiguration:

- **Telegram-Testnachricht:** verwendet die Testvorlage und den gewählten Telegram-Benutzer.
- **Testanruf:** verwendet die Telefonvorlage mit Ereignis „Test“ und ruft alle aktivierten eindeutigen Telefonnummern an, unabhängig von der Bereichszuordnung.

Tests lösen weder einen Alarm noch Sirenen oder Szenen aus. Parallele bzw. innerhalb von zehn Sekunden wiederholte Tests desselben Kanals werden zurückgewiesen. Das Testergebnis bedeutet eine beantwortete Versand-/Anrufanforderung, keine nachgewiesene Zustellung oder Gesprächsannahme. Ausbleibende Rückmeldungen werden nach spätestens 120 Sekunden als Fehler angezeigt.

## Grenzen und Prüfung

- Nach Adapterstart sind Einbruchsbereiche unscharf und Panik zurückgesetzt. Aktive Sabotagekontakte und externe Panikeingänge werden aus dem Startzustand neu ausgewertet. Die Alarmmerker selbst werden nicht über Neustarts wiederhergestellt; das Ereignisprotokoll bleibt erhalten.
- Veraltete, aber weiterhin gültig gespeicherte KNX-Werte werden noch nicht als Verbindungsfehler erkannt.
- Bei Stromausfall oder Prozessabsturz kann die Software keinen Ausschaltbefehl senden. Eine erforderliche unabhängige Sirenenabschaltung gehört zusätzlich in den Aktor.
- Telefonannahmeerkennung, DTMF-Quittierung und automatische Eskalationsketten sind nicht enthalten. Bereits angeforderte Nachrichten/Anrufe werden nicht zurückgerufen.
- Keine eigene VIS-Oberfläche oder PIN-Prüfung. Berechtigungen für Modus, Sensor-enable und Panik sind über die vorhandene ioBroker-Installation einzurichten.
- Reale KNX-Geräte, Admin-Darstellung, Szenen und Versand müssen in einer Testinstanz geprüft werden. Automatisierte Tests verwenden eine simulierte Uhr und eine Attrappe der Adapter-Schnittstellen.

```sh
npm install
npm run check
npm test
```

GitHub Actions führt Syntaxprüfung und Tests unter Node 20, 22 und 24 aus. Die Tests umfassen auch die Übernahme alter Konfigurationen, gespeicherte Sensoraktivierung, Sabotage, Benachrichtigungsvorlagen, Testschaltflächen und unabhängige Panikaktionen.

## Schnittstellenquellen

- [ioBroker CLI](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/config/cli.md): Backup, Instanzsteuerung und Upload.
- [ioBroker jsonConfig](https://github.com/ioBroker/json-config): Konfiguration und `sendTo`-Testschaltflächen.
- [Asterisk-Dokumentation](https://github.com/schmupu/ioBroker.asterisk): `sendTo(instance, 'dial', { telnr, text })`.
- [Telegram-Dokumentation](https://github.com/iobroker-community-adapters/ioBroker.telegram/blob/master/docs/en/README.md): `sendTo(instance, 'send', { text, user })`.

## Changelog

### 0.2.0

Sabotagekontakte, dauerhafte Sensorschaltung und Sensorchannels, Nachrichtenvorlagen und Informationsmeldungen, Panik mit Szene, Testnachrichten/-anrufe, Bereitschaftsanzeigen und Ereignisprotokoll. Eingangsverzögerungen mehrerer Sensoren behalten eigene Fristen. Bestehende Konfigurationen werden mit neuen Standardoptionen ergänzt.

### 0.1.0

Erste Entwicklungsversion mit Bereichssteuerung, Sensorlogiken, Sirenen, Telegram und Asterisk.

## Lizenz

MIT, Copyright (c) 2026 ToSchu41.
