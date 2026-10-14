/*
 * Pré-preenchimento do formulário "Reanálise de Qualidade".
 *
 * Lê dois parâmetros do endereço e preenche o formulário; o analista continua revisando e enviando como hoje:
 *   ?chamado=MS-00394727&criterios=clara,encerramento,lgpd
 *   ?chamado=MS-00394727&criterios=clara&analista=nome.sobrenome@turbi.com.br   (analista é opcional)
 *
 * chamado   -> número do ticket (letras, números, ponto, hífen e sublinhado; até 40 caracteres)
 * analista  -> e-mail do analista (@turbi.com.br). Em página com campo de texto, preenche e trava o campo.
 *              Em página com lista de analistas (select), só vale se o e-mail existir na lista.
 * criterios -> códigos separados por vírgula:
 *   clara            = Condução - Comunicação clara
 *   respostas        = Condução - Resposta a todas as perguntas
 *   autoatendimento  = Processos - Autoatendimento
 *   encerramento     = Comportamento - Encerramento abrupto
 *   descaso          = Comportamento - Descaso/Frieza
 *   lgpd             = Compliance - LGPD
 *
 * Como funciona: encontra os campos pelo TEXTO do rótulo que aparece na tela, então não depende dos ids do HTML.
 * Só atribui valores com .value e .click() (nunca insere HTML) e ignora qualquer parâmetro fora do padrão.
 * Sem parâmetros no endereço, não faz nada.
 */
(function () {
  "use strict";

  var CRITERIOS = {
    clara: "conducao - comunicacao clara",
    respostas: "conducao - resposta a todas as perguntas",
    autoatendimento: "processos - autoatendimento",
    encerramento: "comportamento - encerramento abrupto",
    descaso: "comportamento - descaso/frieza",
    lgpd: "compliance - lgpd"
  };

  var MAX_TENTATIVAS = 4;   // se o formulário for montado depois do carregamento, tenta de novo
  var ESPERA_MS = 300;

  function normalizar(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Procura o campo pelo texto do rótulo. exato=true exige o texto inteiro; false aceita "começa com".
  function campoPorRotulo(textoRotulo, seletor, exato) {
    var alvo = normalizar(textoRotulo);
    var rotulos = document.querySelectorAll("label");
    for (var i = 0; i < rotulos.length; i++) {
      var texto = normalizar(rotulos[i].textContent);
      var confere = exato ? texto === alvo : texto.indexOf(alvo) === 0;
      if (!confere) continue;
      var campo = rotulos[i].control || rotulos[i].querySelector(seletor);
      if (campo && campo.matches(seletor)) return campo;
    }
    // Plano B: rótulo que não é <label> (ex.: <span>/<div> ao lado do campo)
    var todos = document.querySelectorAll("span, div, p, legend");
    for (var j = 0; j < todos.length; j++) {
      if (todos[j].children.length > 0) continue;   // só elementos que têm apenas texto
      var t = normalizar(todos[j].textContent);
      if (!(exato ? t === alvo : t.indexOf(alvo) === 0)) continue;
      var pai = todos[j].parentElement;
      var achado = pai && pai.querySelector(seletor);
      if (achado) return achado;
    }
    return null;
  }

  function preencher(campo, valor) {
    campo.value = valor;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function marcar(campo) {
    if (!campo.checked) campo.click();   // o clique dispara os eventos que a própria página já escuta
  }

  var REGEX_EMAIL = /^[a-z0-9._-]+@turbi\.com\.br$/;

  // Devolve true quando não há nada a fazer ou quando tudo o que foi pedido foi encontrado.
  // "ultima" indica a última tentativa: aí o que não existe na lista é ignorado de vez.
  function aplicar(ultima) {
    var params = new URLSearchParams(window.location.search);
    var chamado = (params.get("chamado") || "").trim();
    var codigos = (params.get("criterios") || "")
      .split(",")
      .map(function (c) { return c.trim().toLowerCase(); })
      .filter(Boolean);

    var analista = (params.get("analista") || "").trim().toLowerCase();

    if (!chamado && codigos.length === 0 && !analista) return true;

    var pedidos = 0;
    var feitos = 0;
    var relatorio = { chamado: "nao pedido", analista: "nao pedido", criterios: [], ignorados: [] };

    if (chamado) {
      pedidos++;
      if (/^[A-Za-z0-9._-]{1,40}$/.test(chamado)) {
        var campoChamado = campoPorRotulo("ID do Chamado", "input", false);
        if (campoChamado) { preencher(campoChamado, chamado); feitos++; relatorio.chamado = "preenchido"; }
        else relatorio.chamado = "campo nao encontrado";
      } else {
        feitos++;   // valor fora do padrão: ignorado de propósito, não adianta tentar de novo
        relatorio.chamado = "ignorado (formato invalido)";
      }
    }

    if (analista) {
      pedidos++;
      var campoAnalista = campoPorRotulo("Analista Responsavel", "select, input", false);
      if (!campoAnalista) {
        relatorio.analista = "campo nao encontrado";
      } else if (!REGEX_EMAIL.test(analista)) {
        feitos++;   // e-mail fora do padrão da Turbi: ignorado de propósito
        relatorio.analista = "ignorado (e-mail invalido)";
      } else if (campoAnalista.tagName === "SELECT") {
        // página com lista de analistas: só vale se o e-mail existir na lista
        var existe = Array.prototype.some.call(campoAnalista.options, function (o) { return o.value === analista; });
        if (existe) { preencher(campoAnalista, analista); feitos++; relatorio.analista = "selecionado"; }
        else if (ultima) { feitos++; relatorio.analista = "ignorado (nao esta na lista)"; }
        else relatorio.analista = "aguardando a lista";
      } else {
        // campo de texto: preenche e TRAVA (o e-mail veio do site, quem contesta não precisa digitar nem trocar)
        preencher(campoAnalista, analista);
        campoAnalista.readOnly = true;
        feitos++;
        relatorio.analista = "preenchido (travado)";
      }
    }

    codigos.forEach(function (codigo) {
      var rotulo = CRITERIOS[codigo];
      if (!rotulo) { relatorio.ignorados.push(codigo); return; }
      pedidos++;
      var caixa = campoPorRotulo(rotulo, "input[type=checkbox]", true);
      if (caixa) { marcar(caixa); feitos++; relatorio.criterios.push(codigo); }
    });

    console.info("[prefill]", relatorio);
    return pedidos === feitos;
  }

  var tentativas = 0;
  function iniciar() {
    tentativas++;
    var ok = aplicar(tentativas >= MAX_TENTATIVAS);
    if (!ok && tentativas < MAX_TENTATIVAS) setTimeout(iniciar, ESPERA_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
