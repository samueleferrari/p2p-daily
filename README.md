# 📸 P2P Daily

P2P Daily è un esperimento di social network fotografico **completamente decentralizzato**. Nessun server centrale, nessun database che immagazzina i tuoi dati e nessuna profilazione. Le tue foto viaggiano direttamente dal tuo dispositivo a quello dei tuoi amici.

---

## 🙋‍♀️ Per gli Utenti: Cos'è e come funziona?

Siamo abituati a social network dove ogni foto, prima di arrivare ai nostri amici, passa per i server di una grande azienda. P2P Daily cambia le regole del gioco.

### 🌟 Caratteristiche Principali
* **Nessun Database Centrale:** Le tue foto e i tuoi contatti sono salvati **solo** sul tuo telefono (nella memoria del browser).
* **Connessione Diretta (Peer-to-Peer):** Quando condividi una foto, il tuo dispositivo crea un "tubo" invisibile e diretto con il dispositivo del tuo amico per passargli l'immagine.
* **Foto Effimere:** Puoi scattare o caricare al massimo una foto al giorno. Le foto ricevute scadono e spariscono automaticamente dal feed allo scadere del tempo.
* **Privacy Assoluta:** 
  * Se hai un **Account Pubblico**, chiunque ti aggiunga riceverà la tua foto del giorno.
  * Se hai un **Account Privato**, chi ti cerca dovrà inviarti una "Richiesta". Finché non premi *Accetta*, il tuo dispositivo rifiuterà fisicamente di inviare i byte della tua foto a quella persona.

### 🚀 Come iniziare
1. Apri l'app e scegli un **Username** (es. `marco99`). Questo nome identificherà il tuo dispositivo nella rete.
2. Scatta o carica la tua foto del giorno.
3. Chiedi ai tuoi amici il loro Username e inseriscilo nella barra **"I tuoi amici"**.
4. Quando siete entrambi online, cliccate su **Sincronizza**: i telefoni si troveranno e si scambieranno le foto in tempo reale!

---

## 💻 Per gli Sviluppatori: Sotto il cofano

P2P Daily è una **Progressive Web App (PWA)** scritta in Vanilla JavaScript, HTML e CSS (Tailwind), basata sul protocollo **WebRTC** per le comunicazioni in tempo reale.

### 🏗️ Architettura e Tech Stack
* **Frontend:** HTML5, Tailwind CSS (via CDN/file separato), Vanilla JS.
* **P2P Networking:** [PeerJS](https://peerjs.com/) per l'astrazione di WebRTC.
* **Storage:** API `localStorage` del browser.
* **Traversamento NAT/Firewall (ICE):** Serverless Function su **Vercel** (`/api/turn.js`) che comunica con le API di **Twilio** per generare credenziali server TURN temporanee.
* **PWA:** Manifest e Service Worker (`sw.js`) per l'installabilità e la gestione della cache offline.

### 🔄 Il Protocollo di Handshake Custom
Poiché non esiste un server centrale a gestire le amicizie, i client devono negoziare la privacy comunicando tra loro in tempo reale. Abbiamo implementato un sistema di messaggistica asincrona basato su JSON inviati tramite `DataConnection` di WebRTC:

1. `follow_request`: Inviata quando A aggiunge B.
2. `follow_response`: B risponde automaticamente con `status: 'private'` o `status: 'accepted'`.
3. `follow_accepted` / `follow_declined`: Inviati quando l'utente B (privato) preme i bottoni sulla UI.
4. `unfollow`: Inviato per rimuovere in background i permessi dalla Whitelist dell'altro peer.
5. `photo`: Il payload contenente l'immagine (in Base64 compresso) e il timestamp.

### 💾 Gestione dello Stato Locale
Tutta la logica di persistenza si basa sul `localStorage`. Gli oggetti principali sono:
* `p2p_friends`: Array di oggetti `{ id: "username", status: "pending" | "accepted" }`.
* `p2p_feed`: Oggetto mappato per utente contenente timestamp e stringa Base64 della foto.
* `p2p_allowed`: La "Whitelist" (Followers) di chi ha il permesso di ricevere i nostri pacchetti WebRTC.
* `p2p_requests`: Array di username in attesa di approvazione (se l'account è privato).

### 🛠️ Setup e Installazione Locale

Per far girare questo progetto in locale ed esplorare il codice, hai bisogno di Node.js e dell'interfaccia a riga di comando di Vercel (poiché le credenziali TURN sono protette da una Serverless Function).

**1. Clona il repository**
```bash
git clone [https://github.com/tuo-username/p2p-daily.git](https://github.com/tuo-username/p2p-daily.git)
cd p2p-daily

```

**2. Configura l'ambiente Twilio (Server TURN)**
Per far funzionare WebRTC anche sotto rete 4G/5G, l'app usa Twilio.

* Crea un account gratuito su [Twilio](https://www.twilio.com/).
* Naviga su *Network Traversal* per ottenere il tuo `ACCOUNT SID` e `AUTH TOKEN`.
* Crea un file `.env` nella root del progetto e inserisci le chiavi:

```env
TWILIO_ACCOUNT_SID=il_tuo_sid_qui
TWILIO_AUTH_TOKEN=il_tuo_token_qui

```

**3. Avvia l'ambiente di sviluppo locale**
Installa la Vercel CLI (se non l'hai già) e avvia il progetto:

```bash
npm i -g vercel
vercel dev

```

L'app sarà disponibile su `http://localhost:3000`.

### 🤝 Come contribuire

I contributi sono benvenuti! Le aree principali di miglioramento attuali includono:

* **UI/UX:** Miglioramento degli stati di caricamento durante la negoziazione WebRTC.
* **Ottimizzazione Immagini:** Attualmente le immagini vengono ridimensionate tramite `canvas` a max 800px e compresse in JPEG (qualità 0.7) in locale prima dell'invio. Si possono implementare algoritmi più efficienti (es. WebP).
* **Sync Background:** Utilizzo delle API Background Sync (dove supportate) per la negoziazione asincrona anche ad app minimizzata.

Crea un *Fork* del progetto, fai le tue modifiche e apri una *Pull Request*!

---

*Sviluppato con passione per un web più libero e decentralizzato.* 🌐
