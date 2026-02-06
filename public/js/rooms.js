document.addEventListener('DOMContentLoaded', function() {
    // Mettre à jour les filtres automatiquement quand une valeur change
   const filterForm = document.getElementById('searchForm');
const filterSelects = filterForm.querySelectorAll('select');

    filterSelects.forEach(select => {
        select.addEventListener('change', () => {
            filterForm.submit();
        });
    });

    // Animation des cartes au chargement
    const roomCards = document.querySelectorAll('.room-card');
    roomCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'all 0.3s ease-out';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 * index);
    });

    // Initialiser les tooltips Bootstrap
    const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    tooltips.forEach(tooltip => {
        new bootstrap.Tooltip(tooltip);
    });

    // Gestion du modal
    const roomModals = document.querySelectorAll('.modal');
    roomModals.forEach(modal => {
        modal.addEventListener('show.bs.modal', function (event) {
            const button = event.relatedTarget;
            const roomId = button.getAttribute('data-room-id');
            // Vous pouvez ajouter ici du code pour charger plus de détails si nécessaire
        });
    });
});
