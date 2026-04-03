using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public sealed class UnityArtInstallationController : MonoBehaviour
{
    [SerializeField] private string baseUrl = "https://artinstallation.certaindragon3.work";
    [SerializeField] private string targetReceiverId = "screen-a";
    [SerializeField] private string sampleMessage = "Hello from Unity";
    [SerializeField] private string sampleColor = "#22c55e";

    [ContextMenu("Fetch Receivers")]
    private void FetchReceiversContextMenu()
    {
        StartCoroutine(GetReceivers());
    }

    [ContextMenu("Send Sample Text")]
    private void SendSampleTextContextMenu()
    {
        StartCoroutine(SendText(targetReceiverId, sampleMessage));
    }

    [ContextMenu("Send Sample Color")]
    private void SendSampleColorContextMenu()
    {
        StartCoroutine(SendColor(targetReceiverId, sampleColor));
    }

    [ContextMenu("Clear Offline Receivers")]
    private void ClearOfflineReceiversContextMenu()
    {
        StartCoroutine(ClearOfflineReceivers());
    }

    public IEnumerator GetReceivers()
    {
        var request = UnityWebRequest.Get(BuildUrl("/api/controller/receivers"));
        yield return request.SendWebRequest();

        try
        {
            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("GetReceivers failed: " + request.error);
                yield break;
            }

            var body = request.downloadHandler.text;
            var response = JsonUtility.FromJson<ReceiversResponse>(body);
            if (response == null || response.receivers == null)
            {
                Debug.LogWarning("GetReceivers returned an unreadable payload: " + body);
                yield break;
            }

            foreach (var receiver in response.receivers)
            {
                Debug.Log(
                    "Receiver " + receiver.receiverId +
                    " connected=" + receiver.connected +
                    " color=" + receiver.iconColor
                );
            }
        }
        finally
        {
            request.Dispose();
        }
    }

    public IEnumerator SendText(string receiverId, string text)
    {
        var payload = new TextCommandRequest
        {
            type = "text_message",
            targetId = receiverId,
            payload = new TextPayload { text = text }
        };

        yield return PostJson("/api/controller/command", JsonUtility.ToJson(payload));
    }

    public IEnumerator SendBroadcastText(string text)
    {
        yield return SendText("*", text);
    }

    public IEnumerator SendColor(string receiverId, string color)
    {
        var payload = new ColorCommandRequest
        {
            type = "color_change",
            targetId = receiverId,
            payload = new ColorPayload { color = color }
        };

        yield return PostJson("/api/controller/command", JsonUtility.ToJson(payload));
    }

    public IEnumerator SetTrackPlayable(string receiverId, int trackId, bool playable)
    {
        var payload = new AudioPlayableCommandRequest
        {
            type = "audio_playable",
            targetId = receiverId,
            payload = new AudioPlayablePayload
            {
                trackId = trackId,
                playable = playable
            }
        };

        yield return PostJson("/api/controller/command", JsonUtility.ToJson(payload));
    }

    public IEnumerator ControlTrack(string receiverId, int trackId, string action)
    {
        var payload = new AudioControlCommandRequest
        {
            type = "audio_control",
            targetId = receiverId,
            payload = new AudioControlPayload
            {
                trackId = trackId,
                action = action
            }
        };

        yield return PostJson("/api/controller/command", JsonUtility.ToJson(payload));
    }

    public IEnumerator ClearOfflineReceivers()
    {
        yield return PostJson("/api/controller/clear-offline", "{}");
    }

    private IEnumerator PostJson(string path, string json)
    {
        var request = new UnityWebRequest(BuildUrl(path), UnityWebRequest.kHttpVerbPOST);
        request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        try
        {
            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("POST " + path + " failed: " + request.error);
                Debug.LogError(request.downloadHandler.text);
                yield break;
            }

            Debug.Log("POST " + path + " response: " + request.downloadHandler.text);
        }
        finally
        {
            request.Dispose();
        }
    }

    private string BuildUrl(string path)
    {
        return baseUrl.TrimEnd('/') + path;
    }

    [Serializable]
    private sealed class ReceiversResponse
    {
        public bool ok;
        public ReceiverState[] receivers;
    }

    [Serializable]
    private sealed class ReceiverState
    {
        public string receiverId;
        public bool connected;
        public string iconColor;
    }

    [Serializable]
    private sealed class TextCommandRequest
    {
        public string type;
        public string targetId;
        public TextPayload payload;
    }

    [Serializable]
    private sealed class ColorCommandRequest
    {
        public string type;
        public string targetId;
        public ColorPayload payload;
    }

    [Serializable]
    private sealed class AudioPlayableCommandRequest
    {
        public string type;
        public string targetId;
        public AudioPlayablePayload payload;
    }

    [Serializable]
    private sealed class AudioControlCommandRequest
    {
        public string type;
        public string targetId;
        public AudioControlPayload payload;
    }

    [Serializable]
    private sealed class TextPayload
    {
        public string text;
    }

    [Serializable]
    private sealed class ColorPayload
    {
        public string color;
    }

    [Serializable]
    private sealed class AudioPlayablePayload
    {
        public int trackId;
        public bool playable;
    }

    [Serializable]
    private sealed class AudioControlPayload
    {
        public int trackId;
        public string action;
    }
}
