// js/forms.js
// Form submission handlers using vanilla fetch + Supabase

document.addEventListener("DOMContentLoaded", () => {
  // ----------------------
  // WAITLIST FORM (prelaunch.html)
  // ----------------------
  const waitlistForm = document.querySelector("#waitlist-form");
  if (waitlistForm) {
    waitlistForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = waitlistForm.querySelector('button[type="submit"]');
      const messageEl = document.createElement("p");
      messageEl.style.marginTop = "1em";
      waitlistForm.appendChild(messageEl);

      // Honeypot check
      if (
        waitlistForm.querySelector(`input[name="${HONEYPOT_FIELD}"]`)?.value
      ) {
        messageEl.textContent = "Submission blocked.";
        messageEl.style.color = "darkred";
        return;
      }

      const email = waitlistForm.querySelector("#email").value.trim();

      if (!email) {
        messageEl.textContent = "Please enter an email.";
        messageEl.style.color = "darkred";
        return;
      }

      submitBtn.disabled = true;
      messageEl.textContent = "Submitting...";

      try {
        const { error } = await supabaseClient
          .from("waitlist")
          .insert({ email });

        if (error) throw error;

        messageEl.textContent =
          "Thank you! You will be notified when we launch.";
        messageEl.style.color = "darkgreen";
        waitlistForm.reset();
      } catch (err) {
        console.error(err);
        messageEl.textContent = "Error: " + (err.message || "Try again later.");
        messageEl.style.color = "darkred";
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ----------------------
  // COUNSEL FORM (submit.html)
  // ----------------------
  const counselForm = document.querySelector("#counsel-form");
  if (counselForm) {
    counselForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = counselForm.querySelector('button[type="submit"]');
      const messageEl = document.createElement("p");
      messageEl.style.marginTop = "1em";
      counselForm.appendChild(messageEl);

      // Honeypot
      if (counselForm.querySelector(`input[name="${HONEYPOT_FIELD}"]`)?.value) {
        messageEl.textContent = "Submission blocked.";
        return;
      }

      const formData = new FormData(counselForm);
      const data = {
        name: formData.get("name")?.trim() || null,
        profession: formData.get("profession")?.trim() || null,
        state: formData.get("state")?.trim() || null,
        question: formData.get("question")?.trim(),
      };

      if (!data.question) {
        messageEl.textContent = "Question is required.";
        messageEl.style.color = "darkred";
        return;
      }

      submitBtn.disabled = true;
      messageEl.textContent = "Sending counsel...";

      try {
        const { error } = await supabaseClient
          .from("counsel_questions")
          .insert(data);

        if (error) throw error;

        messageEl.textContent = "Counsel received — thank you, patriot.";
        messageEl.style.color = "darkgreen";
        counselForm.reset();
      } catch (err) {
        console.error(err);
        messageEl.textContent =
          "Error: " + (err.message || "Please try again.");
        messageEl.style.color = "darkred";
      } finally {
        submitBtn.disabled = false;
      }
    });
  }
});
