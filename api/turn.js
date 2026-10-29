export default async function handler(req, res) {
    // La chiave segreta viene letta dalle impostazioni di Vercel, mai dal codice visibile!
    const apiKey = process.env.METERED_API_KEY;
    
    // Inserisci qui l'URL base che ti ha dato Metered (es. tuo-nome.metered.ca)
    const meteredDomain = "p2pdaily.metered.live"; 

    try {
        // Il server di Vercel chiede a Metered le credenziali ICE temporanee
        const response = await fetch(`https://${meteredDomain}/api/v1/turn/credentials?apiKey=${apiKey}`);
        const iceServers = await response.json();
        
        // Risponde al tuo frontend consegnando la lista dei server pronti all'uso
        res.status(200).json(iceServers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Errore nel recupero delle credenziali TURN" });
    }
}
