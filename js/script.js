// The Watchman's Cry: Common Sense Reborn - JavaScript
// Image modal functionality

// Create modal overlay element
const modal = document.createElement('div');
modal.className = 'image-modal';
document.body.appendChild(modal);

// Create modal image element
const modalImg = document.createElement('img');
modal.appendChild(modalImg);

// Function to open modal with image
function openImageModal(imgSrc, imgAlt) {
  modalImg.src = imgSrc;
  modalImg.alt = imgAlt || 'Enlarged image';
  modal.classList.add('active');
  document.body.classList.add('modal-open');
}

// Function to close modal
function closeImageModal() {
  modal.classList.remove('active');
  document.body.classList.remove('modal-open');
}

// Add click event listeners to all article images when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Find all images in articles (woodcut class or any image in article/section)
  const articleImages = document.querySelectorAll('article img, .section img, .edition img');
  
  articleImages.forEach(function(img) {
    // Skip banner images and other non-article images
    if (img.closest('header') || img.classList.contains('banner')) {
      return;
    }
    
    img.style.cursor = 'pointer';
    img.addEventListener('click', function(e) {
      e.stopPropagation();
      openImageModal(this.src, this.alt);
    });
  });
  
  // Close modal when clicking on overlay or image
  modal.addEventListener('click', function(e) {
    if (e.target === modal || e.target === modalImg) {
      closeImageModal();
    }
  });
  
  // Close modal with Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeImageModal();
    }
  });
});
