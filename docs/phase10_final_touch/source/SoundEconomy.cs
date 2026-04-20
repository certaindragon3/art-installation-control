using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class SoundEconomy : MonoBehaviour
{
    [System.Serializable]
    public class TrackSlot
    {
        public Button button;
        public TMP_Text nameText;
        public TMP_Text costText;
        [HideInInspector] public AudioClip clip;
    }

    [Header("Library")]
    [SerializeField] private List<AudioClip> trackLibrary = new List<AudioClip>();

    [Header("Slots (e.g. 4 buttons on screen)")]
    [SerializeField] private TrackSlot[] slots;

    [Header("UI")]
    [SerializeField] private TMP_Text currencyText;      // "Pool" of seconds
    [SerializeField] private TMP_Text inflationText;     // optional
    [SerializeField] private GameObject gameOverPanel;
    [SerializeField] private TMP_Text gameOverText;

    [Header("Audio")]
    [SerializeField] private AudioSource audioSource;

    [Header("Economy")]
    [SerializeField] private float startingSeconds = 30f;
    [SerializeField] private float earnRatePerSecond = 1f;   // seconds earned per real-time second of silence
    [SerializeField] private float refreshInterval  = 30f;

    [Header("Inflation")]
    [SerializeField] private float inflationStart           = 1f;
    [SerializeField] private float inflationGrowthPerSecond = 0.02f; // +2% per second
    [SerializeField] private bool  inflationGrowsWhilePlaying = true;

    // ---- runtime state ----
    private float currency;
    private float inflation;
    private float refreshTimer;
    private bool  isPlaying;
    private float playEndsAt;
    private bool  gameOver;

    private void Start()
    {
        currency     = startingSeconds;
        inflation    = inflationStart;
        refreshTimer = refreshInterval;

        if (gameOverPanel) gameOverPanel.SetActive(false);

        for (int i = 0; i < slots.Length; i++)
        {
            int captured = i;
            slots[i].button.onClick.AddListener(() => TryPlay(captured));
        }

        RefreshSlots();
    }

    private void Update()
    {
        if (gameOver) return;

        // Inflation climbs over time
        if (inflationGrowsWhilePlaying || !isPlaying)
            inflation += inflationGrowthPerSecond * Time.deltaTime;

        if (isPlaying)
        {
            // A sample just finished -> refresh slots and reset the 30s timer
            if (Time.time >= playEndsAt)
            {
                isPlaying = false;
                audioSource.Stop();
                RefreshSlots();
                refreshTimer = refreshInterval;
            }
        }
        else
        {
            // Silence = earn time
            currency += earnRatePerSecond * Time.deltaTime;

            // 30-second refresh cadence while nothing is playing
            refreshTimer -= Time.deltaTime;
            if (refreshTimer <= 0f)
            {
                RefreshSlots();
                refreshTimer = refreshInterval;
            }
        }

        UpdateUI();
    }

    private void TryPlay(int slotIndex)
    {
        if (gameOver || isPlaying) return;

        var slot = slots[slotIndex];
        if (slot.clip == null) return;

        float cost = CostOf(slot.clip);
        currency -= cost;

        if (currency < 0f)
        {
            TriggerGameOver();
            return;
        }

        audioSource.clip = slot.clip;
        audioSource.Play();
        isPlaying  = true;
        playEndsAt = Time.time + slot.clip.length;

        UpdateUI();
    }

    private void RefreshSlots()
    {
        if (trackLibrary.Count == 0 || slots == null) return;

        var pool = new List<AudioClip>(trackLibrary);
        for (int i = 0; i < slots.Length; i++)
        {
            if (pool.Count == 0) pool.AddRange(trackLibrary); // allow duplicates if library < slots
            int pick = Random.Range(0, pool.Count);
            slots[i].clip = pool[pick];
            pool.RemoveAt(pick);

            if (slots[i].nameText) slots[i].nameText.text = slots[i].clip.name;
        }
    }

    private float CostOf(AudioClip clip)
    {
        return clip == null ? 0f : clip.length * inflation;
    }

    private void UpdateUI()
    {
        if (currencyText)  currencyText.text  = $"Pool: {currency:F1}s";
        if (inflationText) inflationText.text = $"Inflation x{inflation:F2}";

        foreach (var s in slots)
        {
            float cost = CostOf(s.clip);
            if (s.costText) s.costText.text = $"-{cost:F1}s";
            s.button.interactable = !isPlaying && !gameOver;
        }
    }

    private void TriggerGameOver()
    {
        gameOver = true;
        audioSource.Stop();
        if (gameOverPanel) gameOverPanel.SetActive(true);
        if (gameOverText)  gameOverText.text  = "GAME OVER\nYou ran out of Seconds";
        if (currencyText)  currencyText.text  = "Pool: 0.0s";

        foreach (var s in slots) s.button.interactable = false;
    }
}