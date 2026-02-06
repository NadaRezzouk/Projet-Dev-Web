-- Script pour ajouter le support de l'administration des utilisateurs
-- Exécutez ce script dans phpMyAdmin ou via la ligne de commande MySQL

-- 1. Modifier le type ENUM pour inclure 'admin'
ALTER TABLE `users` 
MODIFY COLUMN `type` ENUM('client', 'owner', 'admin') NOT NULL DEFAULT 'client';

-- 2. Ajouter la colonne isActive pour activer/désactiver les comptes
ALTER TABLE `users` 
ADD COLUMN `isActive` TINYINT(1) NOT NULL DEFAULT 1 AFTER `type`;

-- 3. Créer un compte administrateur par défaut (mot de passe: admin123)
-- Le hash bcrypt correspond à 'admin123'
INSERT INTO `users` (`name`, `email`, `password`, `phone`, `type`, `isActive`) VALUES 
('Administrateur', 'admin@roomrental.com', '$2a$10$rQzL5VU7EHzqvL3UpKXdS.8GxTH.qmqU5U7nJyj8w5JWqh7V0sXiW', NULL, 'admin', 1);

-- Note: Le mot de passe par défaut est 'admin123'
-- Changez-le immédiatement après la première connexion!
