# DriveDialer Pro - Project Status & Specificaties

## 🚀 Huidige Functionaliteit
1. **Zoeken op Naam + Onderwerp**: De assistent herkent "Bel [Naam]" en leest nu ook direct het **onderwerp** van de taak voor uit de CSV/Lijst.
2. **Contextuele Feedback**: De AI zegt: "Ik heb Jan Jansen gevonden voor het onderwerp: Offerte zonnepanelen."
3. **Stuurknop Integratie (MediaSession)**: De Play-knop op het stuur start het gesprek nadat de AI de persoon heeft bevestigd.
4. **Handsfree Workflow**: "🎙️ Start" -> "Zoek Jan" -> AI: "Gevonden voor [Onderwerp], druk op stuur" -> 📞 Gesprek start.

## 🧠 Geheugenbeheer & Stabiliteit
- **Cleanup**: Audio nodes worden na gebruik geforceerd uit het geheugen verwijderd.
- **Siri Release**: De microfoon wordt binnen 1.8s na de AI-beurt vrijgegeven voor het OS.

## 🛠 Architectuur
- **Frontend**: React (ESM), Tailwind CSS.
- **AI Engine**: Gemini Live API met `findContactByName` tool.
- **Data**: Contacten bevatten nu expliciet een `subject` veld dat wordt voorgelezen.
