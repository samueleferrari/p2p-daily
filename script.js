// --- LOGICA DI BASE E STATO LOCALE ---
let peer;
let myUsername = localStorage.getItem('myUsername');
let connections = [];

const todayString = new Date().toISOString().split('T')[0];

// Rubrica Amici (Array di stringhe)
let friends = JSON.parse(localStorage.getItem('p2p_friends')) || []; 

// Stato del Feed Locale: { "nome_utente": { date: "...", image: "..." } }
let feedData = JSON.parse(localStorage.getItem('p2p_feed')) || {};

// Pulizia giornaliera: elimina dal feed locale le foto dei giorni precedenti
for (let user in feedData) {
    if (feedData[user].date !== todayString) {
        delete feedData[user];
    }
}
localStorage.setItem('p2p_feed', JSON.stringify(feedData));

// --- INIZIALIZZAZIONE ---
window.onload = () => {
    if (myUsername) {
        showMainApp();
        initPeer(myUsername);
        checkDailyPhoto();
        renderFriends();
        renderTimeline(); // Mostra subito le foto in memoria!
    } else {
        showRegistration();
    }
};

// --- GESTIONE INTERFACCIA SEZIONI ---
function showRegistration() {
    document.getElementById('registration-section').classList.remove('hidden');
    document.getElementById('main-app-section').classList.add('hidden');
    document.getElementById('user-badge').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('registration-section').classList.add('hidden');
    document.getElementById('main-app-section').classList.remove('hidden');
    document.getElementById('user-badge').classList.remove('hidden');
}

function registerDevice() {
    let rawInput = document.getElementById('new-username-input').value.trim().toLowerCase();
    let safeUsername = rawInput.replace(/[^a-z0-9]/g, '');

    if (safeUsername.length < 3) {
        showToast("Usa almeno 3 caratteri alfanumerici.");
        return;
    }
    myUsername = safeUsername;
    initPeer(myUsername);
}

// --- 1. GESTIONE RETE P2P E CONNESSIONI ---
async function initPeer(username) {
    let iceServers = [];

    try {
        showToast("Recupero credenziali di rete...");
        const response = await fetch('/api/turn');
        
        if (response.ok) {
            const data = await response.json();
            
            if (Array.isArray(data)) {
                iceServers = data;
            } else if (data && Array.isArray(data.iceServers)) {
                iceServers = data.iceServers;
            } else if (data && typeof data === 'object') {
                iceServers = [data]; 
            } else {
                throw new Error("Formato credenziali sconosciuto");
            }

            // --- INIZIO_FIX: FILTRO DI SICUREZZA ---
            // 1. Convertiamo vecchi formati 'url' nel nuovo standard 'urls'
            iceServers = iceServers.map(server => {
                if (server.url && !server.urls) {
                    server.urls = server.url;
                }
                return server;
            });

            // 2. Scartiamo tutto ciò che non ha un indirizzo valido
            iceServers = iceServers.filter(server => server.urls);
            iceServers = iceServers.slice(0, 2);

            // 3. Se l'array è vuoto, significa che Metered ci ha mandato un errore
            if (iceServers.length === 0) {
                console.warn("Metered ha restituito un errore invece dei server:", data);
            }
            // --- FINE FIX ---

            // Aggiungiamo sempre il server STUN di Google come rete di sicurezza
            iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
            console.log("I MIEI SERVER ICE SONO:", iceServers);
            
        } else {
            console.warn("API TURN fallita, uso server di base.");
            iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        }
    } catch (error) {
        console.error("Errore recupero TURN:", error);
        iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    // 2. Inizializziamo PeerJS con le credenziali appena ricevute
    peer = new Peer(username, {
        config: {
            iceServers: iceServers
        }
    });

    peer.on('open', (id) => {
        localStorage.setItem('myUsername', id);
        document.getElementById('my-peer-id').textContent = id;
        showMainApp();
        checkDailyPhoto();
        showToast("Sei online, @" + id);
        
        setTimeout(syncFeed, 1000); 
    });

    peer.on('disconnected', () => {
        console.log("Disconnesso dal server PeerJS. Tentativo di riconnessione invisibile...");
        peer.reconnect();
    });

    peer.on('connection', (conn) => {
        setupConnection(conn);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            // Controlliamo se avevamo già questo nome salvato in memoria
            if (localStorage.getItem('myUsername')) {
                showToast("Attenzione: Sei già connesso in un'altra scheda.");
                document.getElementById('main-app-section').classList.add('hidden');
            } else {
                showToast("Questo username è già in uso! Scegline un altro.");
                localStorage.removeItem('myUsername');
                myUsername = null;
                showRegistration();
            }
        } else if (err.type === 'peer-unavailable' || err.message.includes('Could not connect to peer')) {
            // L'amico è offline in questo momento. Ignoriamo in silenzio senza mostrare errori rossi.
            console.log("Un utente cercato è offline al momento.");
        } else {
            // Qualsiasi altro errore imprevisto verrà stampato normalmente
            console.error("Errore P2P:", err);
        }
    });

function setupConnection(conn) {
    connections.push(conn);

    conn.on('open', () => {
        // Quando il canale si apre, invio la mia foto (se c'è).
        // Nelle reti P2P è normale trasmettere, sarà chi riceve a decidere se scartarla.
        const savedPhoto = localStorage.getItem('dailyPhoto');
        const savedDate = localStorage.getItem('dailyDate');
        
        if (savedPhoto && savedDate === todayString) {
            conn.send({
                type: 'photo',
                sender: myUsername,
                date: savedDate,
                image: savedPhoto
            });
        }
    });

    conn.on('data', (data) => {
        // Abbiamo ricevuto una foto
        if (data.type === 'photo' && data.date === todayString) {
            
            // --- INIZIO NUOVO CONTROLLO (IL "BUTTAFUORI") ---
            // Se il mittente NON è nella mia rubrica amici, ignoro il pacchetto
            if (!friends.includes(data.sender)) {
                console.log(`Foto scartata: @${data.sender} non è nei tuoi amici.`);
                return; // Esco immediatamente dalla funzione
            }
            // --- FINE NUOVO CONTROLLO ---

            // Se arriviamo qui, l'utente è un amico. Salviamo la foto!
            feedData[data.sender] = {
                date: data.date,
                image: data.image
            };
            
            // Persistenza: salviamo sul telefono
            localStorage.setItem('p2p_feed', JSON.stringify(feedData));
            
            showToast(`Nuova foto da @${data.sender}!`);
            renderTimeline(); 
        }
    });
}

// --- 2. GESTIONE RUBRICA (AMICI) ---
function manualAddFriend() {
    const targetUser = document.getElementById('add-friend-input').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!targetUser) {
        showToast("Inserisci un username valido.");
        return;
    }
    if (targetUser === myUsername) {
        showToast("Non puoi aggiungere te stesso.");
        return;
    }

    if (!friends.includes(targetUser)) {
        friends.push(targetUser);
        localStorage.setItem('p2p_friends', JSON.stringify(friends));
        renderFriends();
        showToast(`@${targetUser} aggiunto! Sincronizzazione in corso...`);
        document.getElementById('add-friend-input').value = '';
        
        // Tenta subito di connettersi e ascoltare
        const conn = peer.connect(targetUser);
        setupConnection(conn); // <-- CORRETTO
    } else {
        showToast("Segui già questo utente.");
    }
}

function removeFriend(username) {
    friends = friends.filter(f => f !== username);
    localStorage.setItem('p2p_friends', JSON.stringify(friends));
    
    // (Opzionale) Elimina anche dal feed le sue foto se lo rimuovi
    delete feedData[username];
    localStorage.setItem('p2p_feed', JSON.stringify(feedData));
    
    renderFriends();
    renderTimeline();
    showToast(`@${username} rimosso.`);
}

function renderFriends() {
    const list = document.getElementById('friends-list');
    if (friends.length === 0) {
        list.innerHTML = `<p class="text-sm text-gray-400">Non segui ancora nessuno.</p>`;
        return;
    }
    list.innerHTML = '';
    friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-gray-50 px-4 py-3 rounded-xl border border-gray-100";
        div.innerHTML = `
            <span class="font-semibold text-sm text-gray-800">@${friend}</span>
            <button onclick="removeFriend('${friend}')" class="text-red-500 hover:text-red-700 text-xs font-bold transition">Rimuovi</button>
        `;
        list.appendChild(div);
    });
}

// --- 3. GESTIONE FEED E SINCRONIZZAZIONE ---
function syncFeed() {
    if (friends.length === 0) return;
    showToast("Ricerca foto in background...");
    
    friends.forEach(friend => {
        const conn = peer.connect(friend); // Crea la connessione
        setupConnection(conn); // <-- LA RIGA MANCANTE: Mette l'app in ascolto per i dati in arrivo!
    });
}

function renderTimeline() {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    const users = Object.keys(feedData);

    if (users.length === 0) {
        timeline.innerHTML = `
            <p id="empty-timeline-msg" class="text-center text-gray-400 text-sm py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                Nessuna foto ricevuta oggi. Aggiungi amici o clicca su Sincronizza!
            </p>`;
        return;
    }

    users.forEach(user => {
        const post = feedData[user];
        const postDiv = document.createElement('div');
        postDiv.className = "bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col";
        postDiv.innerHTML = `
            <div class="flex items-center mb-3">
                <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex-shrink-0"></div>
                <div class="ml-3">
                    <p class="text-sm font-bold text-gray-900">@${user}</p>
                    <p class="text-xs text-gray-500">Oggi</p>
                </div>
            </div>
            <img src="${post.image}" class="w-full rounded-lg object-cover" alt="Foto di ${user}">
        `;
        // Inserisce sempre in cima
        timeline.prepend(postDiv);
    });
}

// --- 4. GESTIONE FOTOCAMERA / UPLOAD (Invariata) ---
function checkDailyPhoto() {
    const savedPhoto = localStorage.getItem('dailyPhoto');
    const savedDate = localStorage.getItem('dailyDate');
    const uploadSection = document.getElementById('upload-section');
    const displaySection = document.getElementById('my-photo-display');
    const myPhotoImg = document.getElementById('my-photo-img');

    if (savedPhoto && savedDate === todayString) {
        uploadSection.classList.add('hidden');
        displaySection.classList.remove('hidden');
        myPhotoImg.src = savedPhoto;
    } else {
        uploadSection.classList.remove('hidden');
        displaySection.classList.add('hidden');
    }
}

// --- 4. GESTIONE FOTOCAMERA / UPLOAD CON COMPRESSIONE ---
function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Compressione foto in corso...");

    const reader = new FileReader();
    reader.onload = (e) => {
        // Creiamo un'immagine in memoria
        const img = new Image();
        img.onload = () => {
            // Creiamo una tela invisibile per rimpicciolire l'immagine
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; // Larghezza massima per le foto P2P
            let width = img.width;
            let height = img.height;

            // Calcoliamo le nuove proporzioni
            if (width > MAX_WIDTH) {
                height = Math.floor(height * (MAX_WIDTH / width));
                width = MAX_WIDTH;
            }

            canvas.width = width;
            canvas.height = height;

            // Disegniamo l'immagine rimpicciolita sulla tela
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Trasformiamo la tela in un JPEG compresso (0.7 = 70% di qualità)
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

            try {
                // Salviamo l'immagine compressa nel telefono
                localStorage.setItem('dailyPhoto', compressedBase64);
                localStorage.setItem('dailyDate', todayString);

                checkDailyPhoto();
                showToast("Foto salvata! I tuoi amici la riceveranno.");
                
                // Invio a chi è connesso in questo momento
                connections.forEach(conn => {
                    if (conn.open) {
                        conn.send({ type: 'photo', sender: myUsername, date: todayString, image: compressedBase64 });
                    }
                });
            } catch (error) {
                // Catturiamo eventuali errori di memoria piena del telefono
                showToast("Errore di salvataggio: memoria piena o foto troppo grande.");
                console.error(error);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- UTILS ---
let toastTimeout;
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.opacity = '1';
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}
