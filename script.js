// --- LOGICA DI BASE E STATO LOCALE ---
let peer;
let myUsername = localStorage.getItem('myUsername');
let connections = [];

const todayString = new Date().toISOString().split('T')[0];
// Rubrica Amici (Array di stringhe)
let friends = JSON.parse(localStorage.getItem('p2p_friends')) || [];
// Stato del Feed Locale: { "nome_utente": { date: "...", image: "..." } }
let feedData = JSON.parse(localStorage.getItem('p2p_feed')) || {};

// --- STATO PRIVACY E PERMESSI ---
let isPrivate = localStorage.getItem('p2p_isPrivate') === 'true';
// Chi ha il permesso di vedere le nostre foto (Whitelist)
let allowedFollowers = JSON.parse(localStorage.getItem('p2p_allowed')) || [];
// Chi ha chiesto di seguirci
let followRequests = JSON.parse(localStorage.getItem('p2p_requests')) || [];

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
        renderRequests();
        renderFollowers();
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

            // ... (dentro initPeer, dopo aver ricevuto la risposta da /api/turn)
            if (Array.isArray(data)) {
                iceServers = data; // Twilio invia l'array direttamente qui a volte
            } else if (data && Array.isArray(data.iceServers)) {
                iceServers = data.iceServers;
            } else if (data && Array.isArray(data.ice_servers)) {
                iceServers = data.ice_servers; // <--- Gestisce il formato di Twilio (con il trattino basso)
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

    let isReconnecting = false;

    peer.on('disconnected', () => {
        // Evitiamo di far partire mille tentativi contemporaneamente
        if (isReconnecting) return;
        
        isReconnecting = true;
        console.log("Disconnesso dal server PeerJS. Attendo 3 secondi prima di ricollegarmi...");
        
        // Aspettiamo 3 secondi prima di riprovare per evitare un loop infinito
        setTimeout(() => {
            if (peer.disconnected) {
                console.log("Tentativo di riconnessione in corso...");
                peer.reconnect();
            }
            isReconnecting = false;
        }, 3000);
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
}

function setupConnection(conn) {
    connections.push(conn);

    conn.on('open', () => {
        // 1. Controllo se io voglio seguire lui, e in tal caso mando la richiesta
        const myFriendRecord = friends.find(f => f.id === conn.peer);
        
        // Mando la richiesta di follow SOLO se sono ancora in attesa (pending)
        if (myFriendRecord && myFriendRecord.status === 'pending') {
            conn.send({ type: 'follow_request', sender: myUsername });
        }

        // 2. Controllo se devo inviargli la mia foto
        const validPhoto = getValidPhoto();
        if (validPhoto) {
            if (!isPrivate || allowedFollowers.includes(conn.peer)) {
                conn.send({
                    type: 'photo',
                    sender: myUsername,
                    timestamp: Date.now(),
                    image: validPhoto
                });
            }
        }
    });

    conn.on('data', (data) => {
        
        // --- 1. QUALCUNO MI CHIEDE DI SEGUIRMI ---
        if (data.type === 'follow_request') {
            if (isPrivate) {
                if (!allowedFollowers.includes(data.sender) && !followRequests.includes(data.sender)) {
                    followRequests.push(data.sender);
                    localStorage.setItem('p2p_requests', JSON.stringify(followRequests));
                    renderRequests();
                    showToast(`Nuova richiesta di amicizia da @${data.sender}!`);
                }
                // Rispondo al suo telefono: "Sono privato, aspetta in coda"
                conn.send({ type: 'follow_response', status: 'private', sender: myUsername });
            } else {
                if (!allowedFollowers.includes(data.sender)) {
                    allowedFollowers.push(data.sender);
                    localStorage.setItem('p2p_allowed', JSON.stringify(allowedFollowers));
                    renderFollowers();
                }
                // Rispondo al suo telefono: "Sono pubblico, sei stato accettato subito"
                conn.send({ type: 'follow_response', status: 'accepted', sender: myUsername });
            }
        }

        // --- 2. RICEVO LA RISPOSTA ALLA MIA RICHIESTA ---
        if (data.type === 'follow_response') {
            const friendIndex = friends.findIndex(f => f.id === data.sender);
            if (friendIndex !== -1) {
                if (data.status === 'accepted') {
                    // Se lui è pubblico, mi accetta istantaneamente: tolgo "In attesa"
                    friends[friendIndex].status = 'accepted';
                    localStorage.setItem('p2p_friends', JSON.stringify(friends));
                    renderFriends();
                    showToast(`Ora segui @${data.sender}!`);
                } else if (data.status === 'private') {
                    // L'etichetta resta, ma l'utente viene avvisato
                    showToast(`L'account di @${data.sender} è privato. In attesa di approvazione.`);
                }
            }
        }

        // --- 3. L'AMICO PRIVATO CLICCA "ACCETTA" DAL SUO SCHERMO ---
        if (data.type === 'follow_accepted') {
            const friendIndex = friends.findIndex(f => f.id === data.sender);
            if (friendIndex !== -1) {
                // Rimuoviamo finalmente il badge giallo!
                friends[friendIndex].status = 'accepted';
                localStorage.setItem('p2p_friends', JSON.stringify(friends));
                renderFriends();
                showToast(`@${data.sender} ha accettato la tua richiesta!`);
            }
        }

        // --- 4. L'AMICO PRIVATO CLICCA "RIFIUTA" DAL SUO SCHERMO ---
        if (data.type === 'follow_declined') {
            // Eliminiamo la persona dalla nostra lista amici
            friends = friends.filter(f => f.id !== data.sender);
            localStorage.setItem('p2p_friends', JSON.stringify(friends));
            renderFriends();
            showToast(`@${data.sender} ha rifiutato la tua richiesta.`);
        }

        // --- 5. GESTIONE RICEZIONE FOTO ---
        if (data.type === 'photo') {
            // BUGFIX: Il buttafuori controlla se la richiesta è in stato 'accepted'
            const isFriend = friends.some(f => f.id === data.sender && f.status === 'accepted');
            
            if (!isFriend) {
                console.log(`Foto scartata: non sei autorizzato o sei ancora in attesa per @${data.sender}.`);
                return; 
            }

            feedData[data.sender] = {
                timestamp: data.timestamp,
                image: data.image
            };
            localStorage.setItem('p2p_feed', JSON.stringify(feedData));
            showToast(`Nuova foto da @${data.sender}!`);
            renderTimeline(); 
        }
    });
}

// --- 2. GESTIONE RUBRICA (AMICI) ---
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

    // Controlliamo se l'amico esiste già cercando il suo .id
    const existingFriend = friends.find(f => f.id === targetUser);
    
    if (!existingFriend) {
        // Salviamo l'amico COME OGGETTO, non come stringa!
        friends.push({ id: targetUser, status: 'pending' });
        localStorage.setItem('p2p_friends', JSON.stringify(friends));
        
        renderFriends();
        showToast(`@${targetUser} aggiunto! Sincronizzazione in corso...`);
        document.getElementById('add-friend-input').value = '';
        
        // Tenta subito di connettersi e ascoltare
        const conn = peer.connect(targetUser);
        setupConnection(conn);
    } else {
        showToast("Segui già questo utente o sei in attesa.");
    }
}

function removeFriend(username) {
    // Filtra rigorosamente usando l'id dell'oggetto
    friends = friends.filter(f => f.id !== username);
    localStorage.setItem('p2p_friends', JSON.stringify(friends));
    
    delete feedData[username];
    localStorage.setItem('p2p_feed', JSON.stringify(feedData));
    
    renderFriends();
    renderTimeline();
    showToast(`Non segui più @${username}.`);
}

function renderFriends() {
    const list = document.getElementById('friends-list');
    
    if (friends.length === 0) {
        list.innerHTML = `<p class="text-sm text-gray-400">Non segui ancora nessuno.</p>`;
        return;
    }
    
    list.innerHTML = '';
    
    friends.forEach(friend => {
        const isPending = friend.status === 'pending';
        const badge = isPending ? `<span class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full ml-2 font-bold">In attesa</span>` : '';
        
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-gray-50 px-4 py-3 rounded-xl border border-gray-100";
        div.innerHTML = `
            <div class="flex items-center">
                <span class="font-semibold text-sm text-gray-800">@${friend.id}</span>
                ${badge}
            </div>
            <button onclick="removeFriend('${friend.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold transition">Rimuovi</button>
        `;
        list.appendChild(div);
    });
}

// --- 3. GESTIONE FEED E SINCRONIZZAZIONE ---
function syncFeed() {
    if (friends.length === 0) return;
    showToast("Sincronizzazione in corso...");
    
    // Se per caso siamo disconnessi, proviamo a rientrare prima di cercare
    if (peer.disconnected) {
        peer.reconnect();
    }
    
    friends.forEach(friend => {
        // CORREZIONE VITALE: Usiamo friend.id, non tutto l'oggetto!
        if (friend && friend.id) {
            const conn = peer.connect(friend.id); 
            setupConnection(conn); 
        }
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
// // Imposta qui i secondi di validità per i tuoi test (es. 60 secondi)
const PHOTO_LIFETIME_SECONDS = 300; 

function checkDailyPhoto() {
    const savedPhoto = localStorage.getItem('dailyPhoto');
    const savedTimestamp = localStorage.getItem('photoTimestamp'); // Nuova chiave temporale
    
    const uploadSection = document.getElementById('upload-section');
    const displaySection = document.getElementById('my-photo-display');
    const myPhotoImg = document.getElementById('my-photo-img');

    let isValid = false;

    if (savedPhoto && savedTimestamp) {
        const now = Date.now(); // Ora attuale in millisecondi
        const timePassedSeconds = (now - parseInt(savedTimestamp, 10)) / 1000;
        
        // Se il tempo trascorso è minore del limite impostato, la foto è valida
        if (timePassedSeconds < PHOTO_LIFETIME_SECONDS) {
            isValid = true;
        }
    }

    if (isValid) {
        // La foto è ancora valida
        uploadSection.classList.add('hidden');
        displaySection.classList.remove('hidden');
        myPhotoImg.src = savedPhoto;
    } else {
        // La foto è scaduta o non esiste: puliamo la memoria e mostriamo l'upload
        if (savedPhoto) {
            localStorage.removeItem('dailyPhoto');
            localStorage.removeItem('photoTimestamp');
        }
        uploadSection.classList.remove('hidden');
        displaySection.classList.add('hidden');
    }
}

function getValidPhoto() {
    const savedPhoto = localStorage.getItem('dailyPhoto');
    const savedTimestamp = localStorage.getItem('photoTimestamp');
    
    if (!savedPhoto || !savedTimestamp) return null;
    
    const timePassedSeconds = (Date.now() - parseInt(savedTimestamp, 10)) / 1000;
    if (timePassedSeconds < PHOTO_LIFETIME_SECONDS) {
        return savedPhoto;
    }
    return null;
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
                // localStorage.setItem('dailyDate', todayString);
                localStorage.setItem('photoTimestamp', Date.now().toString());

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


// --- GESTIONE PRIVACY E RICHIESTE ---
function togglePrivacy() {
    isPrivate = document.getElementById('privacy-toggle').checked;
    localStorage.setItem('p2p_isPrivate', isPrivate);
    renderRequests();
    showToast(isPrivate ? "Account reso Privato" : "Account reso Pubblico");
}

function acceptRequest(username) {
    // 1. Lo rimuovo dalle richieste in sospeso
    followRequests = followRequests.filter(u => u !== username);
    localStorage.setItem('p2p_requests', JSON.stringify(followRequests));
    
    // 2. Lo aggiungo alla Whitelist
    if (!allowedFollowers.includes(username)) {
        allowedFollowers.push(username);
        localStorage.setItem('p2p_allowed', JSON.stringify(allowedFollowers));
    }
    
    renderRequests();
    renderFollowers();
    showToast(`Hai accettato @${username}`);

    // 3. Forzo la NOTIFICA di accettazione sulla rete e invio la foto
    const conn = peer.connect(username);
    conn.on('open', () => {
        // Dico all'amico di togliere il badge giallo "In attesa"
        conn.send({ type: 'follow_accepted', sender: myUsername });
        
        // Se ho una foto, gliela invio subito!
        const validPhoto = getValidPhoto();
        if (validPhoto) {
            conn.send({ type: 'photo', sender: myUsername, timestamp: Date.now(), image: validPhoto });
        }
    });
}

function declineRequest(username) {
    followRequests = followRequests.filter(u => u !== username);
    localStorage.setItem('p2p_requests', JSON.stringify(followRequests));
    renderRequests();
    
    // Mando la NOTIFICA di rifiuto all'utente (lo farà sparire dalla sua lista)
    const conn = peer.connect(username);
    conn.on('open', () => {
        conn.send({ type: 'follow_declined', sender: myUsername });
    });
}

function renderRequests() {
    const section = document.getElementById('requests-section');
    const list = document.getElementById('requests-list');
    
    // Imposta lo stato iniziale del bottone toggle
    const toggleBtn = document.getElementById('privacy-toggle');
    if (toggleBtn) toggleBtn.checked = isPrivate;

    if (!isPrivate || followRequests.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';
    
    followRequests.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-orange-50 px-4 py-3 rounded-xl border border-orange-100";
        div.innerHTML = `
            <span class="font-semibold text-sm text-gray-800">@${req}</span>
            <div class="flex gap-2">
                <button onclick="acceptRequest('${req}')" class="bg-black text-white px-3 py-1 rounded-lg text-xs font-bold transition">Accetta</button>
                <button onclick="declineRequest('${req}')" class="text-gray-500 hover:text-red-500 px-2 py-1 text-xs font-bold transition">Rifiuta</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// --- GESTIONE FOLLOWER (CHI MI SEGUE) ---
function removeFollower(username) {
    // Rimuovo l'utente dalla mia whitelist (non riceverà più le mie foto)
    allowedFollowers = allowedFollowers.filter(u => u !== username);
    localStorage.setItem('p2p_allowed', JSON.stringify(allowedFollowers));
    
    renderFollowers();
    showToast(`Hai rimosso @${username} dai tuoi follower.`);
}

function renderFollowers() {
    const list = document.getElementById('followers-list');
    
    if (allowedFollowers.length === 0) {
        list.innerHTML = `<p class="text-sm text-gray-400">Nessuno riceve le tue foto al momento.</p>`;
        return;
    }
    
    list.innerHTML = '';
    allowedFollowers.forEach(follower => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-blue-50 px-4 py-3 rounded-xl border border-blue-100";
        div.innerHTML = `
            <span class="font-semibold text-sm text-gray-800">@${follower}</span>
            <button onclick="removeFollower('${follower}')" class="text-red-500 hover:text-red-700 text-xs font-bold transition">Rimuovi</button>
        `;
        list.appendChild(div);
    });
}
