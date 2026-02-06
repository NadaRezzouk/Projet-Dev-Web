/**
 * Script de configuration pour l'interface admin
 * Usage: node setup-admin.js
 */

require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcryptjs');

async function setup() {
    console.log('\n🔧 Configuration de l\'interface administrateur...\n');
    
    try {
        // Vérifier si la colonne isActive existe
        const [columns] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'isActive'`
        );
        
        if (columns.length === 0) {
            console.log('📝 Ajout de la colonne isActive...');
            await db.query('ALTER TABLE users ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1');
            console.log('✅ Colonne isActive ajoutée');
        } else {
            console.log('✅ Colonne isActive existe déjà');
        }
        
        // Vérifier si le type admin existe déjà
        const [typeInfo] = await db.query(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'type'`
        );
        
        const hasAdminType = typeInfo[0].COLUMN_TYPE.includes('admin');
        
        if (!hasAdminType) {
            console.log('📝 Ajout du type admin...');
            await db.query('ALTER TABLE users MODIFY COLUMN type ENUM("client", "owner", "admin") NOT NULL DEFAULT "client"');
            console.log('✅ Type admin ajouté');
        } else {
            console.log('✅ Type admin existe déjà');
        }
        
        // Vérifier si un admin existe déjà
        const [admins] = await db.query('SELECT id, email FROM users WHERE type = "admin"');
        
        if (admins.length === 0) {
            console.log('📝 Création du compte administrateur...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.query(
                'INSERT INTO users (name, email, password, type, isActive) VALUES (?, ?, ?, ?, ?)',
                ['Administrateur', 'admin@roomrental.com', hashedPassword, 'admin', 1]
            );
            console.log('✅ Compte administrateur créé');
            console.log('\n' + '='.repeat(50));
            console.log('📧 Email: admin@eventspace.com');
            console.log('🔑 Mot de passe: admin123');
            console.log('⚠️  Changez ce mot de passe après la première connexion!');
            console.log('='.repeat(50));
        } else {
            console.log('✅ Un administrateur existe déjà:', admins[0].email);
        }
        
        console.log('\n✅ Configuration terminée avec succès!\n');
        console.log('Vous pouvez maintenant démarrer le serveur avec: node app.js');
        console.log('Puis connectez-vous sur: http://localhost:3000/login\n');
        
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Erreur:', err.message);
        process.exit(1);
    }
}

setup();
