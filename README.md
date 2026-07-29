# ioBroker Alarm Control

Version 0.1.1 enthält eine vollständig überarbeitete Admin-Oberfläche mit den Haupt-Tabs Übersicht, Allgemein, Melder, Meldegruppen, Sicherungsbereiche, Alarmaktionen, Anwesenheit und Schnittstellen.

## Installation

```bash
iobroker url https://github.com/ToSchu41/ioBroker.alarm-control --host <HOSTNAME>
iobroker add alarm-control
```

## Konfiguration

Datenpunkt → Melder → Meldegruppe → Sicherungsbereich → Alarmaktion

## Sicherheit

Der Adapter ersetzt keine zertifizierte Einbruchmeldeanlage. Telefon- und Sirenenaktionen zuerst mit Testdatenpunkten prüfen.

## Changelog

### 0.1.4

- Objektbrowser für Melder-Datenpunkte und Aktor-Zieldatenpunkte
- Objektbrowser für Residents- und Asterisk-Datenpunkt
- Suchfunktion nach ID und Bezeichnung
- Tabellenänderungen aktivieren zuverlässig die Speichern-Funktion


### 0.1.3

- Schlichteres, technisches Admin-Design
- Neutrale Grau- und Weißtöne
- Nur noch eine dezente Akzentfarbe
- Weniger Schatten, Rundungen und farbliche Hervorhebungen


### 0.1.1
- Admin-Oberfläche vollständig überarbeitet
- Klare Haupt-Tabs ergänzt
- Übersicht mit Konfigurationsablauf
- Kartenlayout und verbesserte Tabellen
- Residents und Schnittstellen getrennt dargestellt

### 0.1.0
- Erste Version


## 0.1.2

- Eigene, von Materialize unabhängige Tab-Navigation
- Nur der aktive Konfigurationsbereich wird angezeigt
- Themegerechter Hintergrund ohne erzwungene weiße Seite
- Bessere Darstellung im Dark Mode
