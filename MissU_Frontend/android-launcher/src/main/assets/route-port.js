(() => {
  if (window !== window.top || window.__missuPortListener) return;
  window.__missuPortListener = true;
  window.addEventListener('message', function receive(event) {
    if (event.source || event.data !== 'missu-route-port-v2' || event.ports.length !== 1) return;
    const port = event.ports[0];
    const requests = new Map();
    let sequence = 0;
    port.onmessage = ({ data }) => {
      const reply = JSON.parse(data);
      const request = requests.get(reply.request);
      if (!request) return;
      clearTimeout(request.timer);
      requests.delete(reply.request);
      if (reply.error) request.reject(new Error(reply.error));
      else request.resolve(reply.state || {});
    };
    window.missuRoute = {
      call(command, args) {
        return new Promise((resolve, reject) => {
          const request = ++sequence;
          const timer = setTimeout(
            () => {
              requests.delete(request);
              reject(new Error('휴대폰에서 응답하지 않았어요. 알림과 위치 권한을 확인해 주세요.'));
            },
            command === 'prepare' || command === 'pushEnable' ? 180000 : 10000,
          );
          requests.set(request, { resolve, reject, timer });
          port.postMessage(JSON.stringify({ request, command, ...args }));
        });
      },
    };
  });
})();
