/**
 * Script pour créer un compte administrateur
 * Usage: node create-admin.js
 */

require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function createAdmin() {
    console.log('\n🔐 Création d\'un compte administrateur\n');
    console.log('=' .repeat(50));
    
    try {
        // Demander les informations
        const name = await question('Nom de l\'administrateur: ');
        const email = await question('Email: ');
        const password = await question('Mot de passe: ');
        
        if (!name || !email || !password) {
            console.error('\n❌ Tous les champs sont requis');
            process.exit(1);
        }
        
        // Vérifier si l'email existe déjà
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            console.error('\n❌ Cet email est déjà utilisé');
            process.exit(1);
        }
        
        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insérer l'administrateur
        const [result] = await db.query(
            'INSERT INTO users (name, email, password, type, isActive) VALUES (?, ?, ?, ?, ?)',
            [name, email, hashedPassword, 'admin', 1]
        );
        
        console.log('\n' + '=' .repeat(50));
        console.log('✅ Administrateur créé avec succès!');
        console.log('=' .repeat(50));
        console.log(`ID: ${result.insertId}`);
        console.log(`Nom: ${name}`);
        console.log(`Email: ${email}`);
        console.log(`Type: admin`);
        console.log('=' .repeat(50));
        console.log('\n📝 Vous pouvez maintenant vous connecter sur /login\n');
        
    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
    } finally {
        rl.close();
        process.exit(0);
    }
}

// Vérifier d'abord si la colonne isActive existe
async function checkAndMigrateDatabase() {
    try {
        // Vérifier si la colonne isActive existe
        const [columns] = await db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'isActive'
        `, [process.env.DB_NAME || 'roomrental']);
        
        if (columns.length === 0) {
            console.log('⚙️  Migration de la base de données...');
            
            // Ajouter la colonne isActive
            await db.query('ALTER TABLE users ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1');
            console.log('✅ Colonne isActive ajoutée');
            
            // Modifier le type ENUM pour inclure admin
            await db.query('ALTER TABLE users MODIFY COLUMN type ENUM("client", "owner", "admin") NOT NULL DEFAULT "client"');
            console.log('✅ Type ENUM mis à jour pour inclure admin');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Erreur lors de la vérification de la base de données:', error.message);
        return false;
    }
}

// Lancer le script
(async () => {
    const migrated = await checkAndMigrateDatabase();
    if (migrated) {
        await createAdmin();
    } else {
        console.error('\n❌ Impossible de continuer sans la migration de la base de données');
        process.exit(1);
    }
})();
