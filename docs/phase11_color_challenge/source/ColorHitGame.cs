using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class ColorHitGame : MonoBehaviour
{
    [System.Serializable]
    public class ColorOption
    {
        public string name;
        public Color  color = Color.white;
    }

    [System.Serializable]
    public class Choice
    {
        public Button   button;
        public Image    swatch;   // colored background of the button
        public TMP_Text label;    // optional color name text
        [HideInInspector] public int colorIndex;
    }

    [Header("Choices (exactly 2)")]
    [SerializeField] private Choice[] choices = new Choice[2];

    [Header("Pointer / Gradient")]
    [SerializeField] private RectTransform gradientBar;   // the red->green->red bar
    [SerializeField] private RectTransform pointer;       // little marker that slides across

    [Header("UI")]
    [SerializeField] private TMP_Text scoreText;
    [SerializeField] private TMP_Text assignedGroupText;  // "Your color: GREEN"
    [SerializeField] private GameObject gameOverPanel;
    [SerializeField] private TMP_Text gameOverText;
    [SerializeField] private GameObject interactiveRoot;  // parent of buttons + pointer; hidden on game over

    [Header("Palette / Groups")]
    [SerializeField] private List<ColorOption> palette = new List<ColorOption>();
    [SerializeField] private bool refreshAssignedColorEachIteration = true;

    [Header("Round Timing (seconds)")]
    [SerializeField] private float minInterval = 2f;
    [SerializeField] private float maxInterval = 3f;

    [Header("Scoring")]
    [SerializeField] private float startingScore    = 1f;
    [SerializeField] private float maxReward        = 3f;   // correct hit at green center
    [SerializeField] private float minWrongPenalty  = 0.5f; // wrong hit at red edges
    [SerializeField] private float maxWrongPenalty  = 1.5f; // wrong hit at green center
    [SerializeField] private float missPenalty      = 1f;   // no press before time expires

    // runtime state
    private float score;
    private bool  gameOver;
    private float iterationStartTime;
    private float iterationDuration;
    private int   correctIndex;
    private int   assignedColorIndex = -1;
    private bool  resolved;

    private void Start()
    {
        if (palette.Count < 2)
        {
            Debug.LogError("[ColorHitGame] Palette needs at least 2 colors.");
            enabled = false;
            return;
        }

        score = startingScore;
        if (gameOverPanel) gameOverPanel.SetActive(false);

        for (int i = 0; i < choices.Length; i++)
        {
            int captured = i;
            choices[i].button.onClick.AddListener(() => OnChoicePressed(captured));
        }

        PickAssignedColor();
        StartIteration();
        UpdateUI();
    }

    private void Update()
    {
        if (gameOver) return;

        float t = Mathf.Clamp01((Time.time - iterationStartTime) / iterationDuration);
        UpdatePointer(t);

        // Time expired without a press -> miss penalty
        if (!resolved && t >= 1f)
        {
            ApplyScore(-missPenalty);
            resolved = true;
            if (!gameOver) StartIteration();
        }
    }

    // --------------------------------------------------------------
    // Iteration lifecycle
    // --------------------------------------------------------------
    private void StartIteration()
    {
        resolved           = false;
        iterationStartTime = Time.time;
        iterationDuration  = Random.Range(minInterval, maxInterval);

        if (refreshAssignedColorEachIteration)
            PickAssignedColor();

        // Pick two distinct colors for the slots
        int a = Random.Range(0, palette.Count);
        int b = Random.Range(0, palette.Count);
        while (b == a) b = Random.Range(0, palette.Count);

        // Guarantee one of them is the assigned (correct) color
        if (a != assignedColorIndex && b != assignedColorIndex)
        {
            if (Random.value < 0.5f) a = assignedColorIndex;
            else                     b = assignedColorIndex;
        }

        // Randomize which side holds the correct one
        if (Random.value < 0.5f) { int tmp = a; a = b; b = tmp; }

        choices[0].colorIndex = a;
        choices[1].colorIndex = b;

        for (int i = 0; i < choices.Length; i++)
        {
            var opt = palette[choices[i].colorIndex];
            if (choices[i].swatch) choices[i].swatch.color = opt.color;
            if (choices[i].label)  choices[i].label.text   = opt.name;
            choices[i].button.interactable = true;
        }

        correctIndex = (choices[0].colorIndex == assignedColorIndex) ? 0 : 1;
        UpdateUI();
    }

    private void PickAssignedColor()
    {
        assignedColorIndex = Random.Range(0, palette.Count);
    }

    // --------------------------------------------------------------
    // Pointer / gradient math
    // --------------------------------------------------------------
    private void UpdatePointer(float t)
    {
        if (gradientBar == null || pointer == null) return;
        float w = gradientBar.rect.width;
        float x = Mathf.Lerp(-w * 0.5f, w * 0.5f, t);
        pointer.anchoredPosition = new Vector2(x, pointer.anchoredPosition.y);
    }

    /// <summary> 0 at the red edges (t=0, t=1), 1 at the green center (t=0.5). </summary>
    private float Greenness(float t) => 1f - Mathf.Abs(2f * t - 1f);

    // --------------------------------------------------------------
    // Input handling
    // --------------------------------------------------------------
    private void OnChoicePressed(int idx)
    {
        if (gameOver || resolved) return;

        float t = Mathf.Clamp01((Time.time - iterationStartTime) / iterationDuration);
        float g = Greenness(t);

        if (idx == correctIndex)
        {
            // Reward 0..maxReward scaled by gradient position
            ApplyScore(maxReward * g);
        }
        else
        {
            // Wrong color: penalty minWrong..maxWrong scaled by gradient
            float penalty = Mathf.Lerp(minWrongPenalty, maxWrongPenalty, g);
            ApplyScore(-penalty);
        }

        resolved = true;
        if (!gameOver) StartIteration();
    }

    // --------------------------------------------------------------
    // Scoring / game-over
    // --------------------------------------------------------------
    private void ApplyScore(float delta)
    {
        score += delta;
        UpdateUI();
        if (score <= 0f) TriggerGameOver();
    }

    private void UpdateUI()
    {
        if (scoreText) scoreText.text = $"Score: {score:F1}";

        if (assignedGroupText && assignedColorIndex >= 0)
        {
            var opt = palette[assignedColorIndex];
            assignedGroupText.text  = $"Your color: {opt.name}";
            assignedGroupText.color = opt.color;
        }
    }

    private void TriggerGameOver()
    {
        gameOver = true;
        score = 0f;
        if (scoreText)     scoreText.text = "Score: 0.0";
        if (gameOverPanel) gameOverPanel.SetActive(true);
        if (gameOverText)  gameOverText.text = "GAME OVER";

        if (interactiveRoot) interactiveRoot.SetActive(false);
        else
        {
            foreach (var c in choices) if (c.button) c.button.interactable = false;
            if (pointer) pointer.gameObject.SetActive(false);
        }
    }
}