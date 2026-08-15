# OpenSketch Studio — Arbeitsweise des Teams

## Grundregel: Kommunikation ist das Wichtigste

Dieses Projekt wird von einem Lead (Senior Developer) und mehreren eigenständigen
Entwickler-Sessions (Junior Developer) gebaut, die über Cross-Session-Messaging
(`ListAgents` / `SendMessage`) miteinander reden.

**Die Kommunikation zwischen Lead und Entwicklern ist der Kern des Ganzen — nicht
der Code.** Wie in einer echten Firma: Der Senior lebt davon, dass seine Junioren
ihm system- und programmierrelevante Informationen zutragen. Nur dann kann er
schnell reagieren, Entscheidungen treffen und andere Entwickler sofort nachziehen
lassen, damit das System sich anpasst. Eine Information, die 20 Minuten in einem
Entwicklerkopf liegen bleibt, ist eine verlorene Information.

Deshalb gilt: **lieber einmal zu viel melden als einmal zu wenig.**

## Protokoll für Entwickler-Sessions

**Sofort melden — nicht bis zum Abschlussbericht warten:**

1. **Contract-Problem** — ein Typ, ein Feld oder eine Funktion fehlt in
   `src/shared/**` oder `src/core/math/**`, oder ein Contract ist widersprüchlich.
   Diese Dateien gehören dem Lead; niemand ändert sie selbst.
2. **Fremdmodul betroffen** — du brauchst etwas von einem anderen Modul, oder ein
   anderes Modul liefert etwas Falsches. Melde es, statt zu umgehen oder zu warten.
3. **Annahme getroffen** — etwas ist unterspezifiziert und du entscheidest dich für
   eine Auslegung. Melden, damit der Lead sie bestätigen oder korrigieren kann,
   bevor andere darauf aufbauen.
4. **Entblockung** — du hast etwas fertig, auf das jemand anderes wartet. Sofort
   melden, damit der Lead die Kollegen nachziehen kann.
5. **Zeitrisiko** — dein Teil dauert deutlich länger als gedacht.

**Takt:** mindestens alle 15–20 Minuten Arbeit ein Zweizeiler zum Stand.

**Form:** kurz, faktisch, mit Datei und Zeile. Keine Romane, keine Höflichkeitsfloskeln.

**Untereinander reden ist erwünscht.** Wenn zwei Module an einer Schnittstelle
klemmen, klärt das direkt und haltet den Lead in Kopie.

**Nie blockieren.** Wartest du auf eine Antwort, arbeite am nächsten Punkt weiter.

## Protokoll für den Lead

- Antworte schnell und entscheide, statt zu vertagen.
- Was ein Entwickler meldet und andere betrifft, sofort an die Betroffenen
  weitergeben — das ist die eigentliche Aufgabe.
- Contract-Änderungen macht ausschließlich der Lead und kündigt sie allen an, die
  betroffen sind.
- Prioritäten aktiv setzen, damit der kritische Pfad nie stillsteht.

## Dateieigentum

Siehe `ARCHITECTURE.md`, Abschnitt 4. Kurz: `src/shared/**`, `src/core/math/**`,
`src/app/**`, `src/main.tsx`, `src/app.css` und alle Konfigurationsdateien gehören
dem Lead. Jedes Modulverzeichnis gehört genau einem Entwickler. Niemand schreibt
in fremde Verzeichnisse, niemand nutzt git — der Lead committet.
