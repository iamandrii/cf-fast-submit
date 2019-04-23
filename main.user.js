// ==UserScript==
// @name         cf-fast-submit
// @name:ja      cf-fast-submit
// @namespace    https://twitter.com/lumc_
// @version      2.3
// @description  append the form to submit to codeforces contest problem page.
// @description:ja codeforcesのコンテストの問題ページに提出フォームを置くツール.
// @author       Luma
// @match        http://codeforces.com/contest/*/problem/*
// @match        http://codeforces.com/gym/*/problem/*
// @match        http://codeforces.com/problemset/problem/*
// @match        https://codeforces.com/contest/*/problem/*
// @match        https://codeforces.com/gym/*/problem/*
// @match        https://codeforces.com/problemset/problem/*
// @grant        none
// ==/UserScript==

/* global $ ace Codeforces */

;(function () {
  'use strict'
  const SCRIPT_NAME = 'cf fast submit'
  const origin = location.origin
  const pathname = location.pathname
  const modelist = ace.require('ace/ext/modelist')
  const logged = !!$('a').filter((_, el) => $(el).text() === 'Logout').length
  let $form
  let $programType
  let $toggleEditor
  let $tabSize
  let $selectProblem
  let editor

  const pattern = /(contest|gym)\/(.*)\/problem\/([^/])*\/?$/
  let type // 'contest' | 'gym' | 'problemset'
  let submitURL
  let problemId
  let contestId
  let participantId

  // got from submit page
  /* eslint-disable-next-line object-property-newline */
  const extensionMap = { 1: 'program.cpp', 2: 'program.cpp', 3: 'program.dpr', 4: 'program.pas', 6: 'program.php', 7: 'program.py', 8: 'program.rb', 9: 'program.cs', 10: 'program.c', 12: 'program.hs', 13: 'program.pl', 19: 'program.ml', 20: '[^{}]*objects+(w+).*|$1.scala', 28: 'program.d', 31: 'a.py', 32: 'program.go', 34: 'program.js', 36: '[^{}]*publics+(final)?s*classs+(w+).*|$2.java', 40: 'a.py', 41: 'a.py', 42: 'program.cpp', 43: 'program.c', 48: 'program.kt', 49: 'program.rs', 50: 'program.cpp', 51: 'program.pas', 52: 'program.cpp', 53: 'program.cpp', 54: 'program.cpp', 55: 'program.js' }

  const regenerateInterval = 30 // minutes
  const retryInterval = 200 // msec

  let doRegenerateOnSubmit = false

  if (!checkRequirements()) return
  if (!initInfo()) return

  tryToInit(true)

  function checkRequirements () {
    if (!logged) {
      console.error(`[${SCRIPT_NAME}] not logged in.`)
      return false
    }
    if (!$) {
      console.error(`[${SCRIPT_NAME}] not found jQuery.`)
      return false
    }
    if (!ace) {
      console.error(`[${SCRIPT_NAME}] not found ace.`)
      return false
    }
    return true
  }

  function initInfo () {
    if (pathname.match(/^\/problemset\//)) {
      type = 'problemset'
      submitURL = origin + '/problemset/submit'
    } else {
      pathname.match(pattern)
      const match = pathname.match(pattern)
      if (!match) return false
      type = match[1]
      submitURL = origin + '/' + type + '/' + match[2] + '/submit'
      problemId = match[3]
    }
    return true
  }

  async function tryToInit (first) {
    for (let i = 0; i < 100; i++) {
      try {
        if (await initAppendForm(first, false)) return
      } catch (e) {
        removeForm()
        console.error(`[${SCRIPT_NAME}] unexpected error has been occured.`)
        throw e
      }
      await delay(retryInterval)
    }
    console.error(`[${SCRIPT_NAME}] tried some times but failed.`)
  }

  function delay (ms) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, ms)
    })
  }

  async function initAppendForm (first = true, doNotRegenerateOnSubmit = false) {
    let code = ''
    let srcFile

    const raw = await $.get(submitURL)
    const $newForm = $(raw).find('form.submit-form')
    if (!$newForm.length) return false

    if (!first) {
      code = getCode() || ''
      srcFile = $form.find('[name=sourceFile]')
      removeForm()
    }

    $form = $newForm

    $('.problem-statement').append($form)

    editor = ace.edit('editor')

    $form.attr('action', submitURL + $form.attr('action'))

    $programType = $form.find('select[name=programTypeId]')
    $toggleEditor = $form.find('#toggleEditorCheckbox')
    $tabSize = $form.find('#tabSizeInput')
    $selectProblem = $form.find('[name=submittedProblemIndex]')

    // codeforces default settings
    editor.setTheme('ace/theme/chrome')
    editor.setShowPrintMargin(false)
    editor.setOptions({
      enableBasicAutocompletion: true
    })

    if (type === 'contest' || type === 'gym') {
      const existsProblemID = $selectProblem.find('option').filter((_, el) => $(el).val() === problemId).length
      if (!existsProblemID) return false
      $selectProblem.val(problemId)
    }

    // そのままdisabledにするとformに含まれなくなるので
    const $cloneSelectProblem = $($selectProblem.prop('outerHTML'))
    $cloneSelectProblem.prop('disabled', true)
    $cloneSelectProblem.removeAttr('name')
    $cloneSelectProblem.attr('id', 'submitted_problem_index_fake_display')
    $selectProblem.after($cloneSelectProblem)

    $selectProblem.prop('hidden', true)

    if (type === 'contest' || type === 'problemset') {
      contestId = (raw.match(/contestId\s*=\s*(\d+)/) || {1: 0})[1]
      participantId = (raw.match(/participantId\s*:\s*(\d+)/) || {1: 0})[1]
    }

    if (raw.match('updateProblemLockInfo')) updateProblemLockInfo()
    if (raw.match('updateSubmitButtonState')) updateSubmitButtonState()

    applyEditorVisibility()
    setAceMode()
    updateFilesAndLimits()

    $toggleEditor.on('change', () => {
      applyEditorVisibility()

      const editorEnabled = !$toggleEditor.is(':checked')
      $.post(
        '/data/customtest',
        {
          communityCode: '',
          action: 'setEditorEnabled',
          editorEnabled: editorEnabled
        },
        function (response) {}
      )
      return false
    })

    $tabSize.on('change', () => {
      const tabSize = $tabSize.val()
      editor.setOptions({ tabSize })
      $.post(
        '/data/customtest',
        { communityCode: '', action: 'setTabSize', tabSize: tabSize },
        function (response) {}
      )
    })

    $programType.on('change', () => {
      setAceMode()
    })

    editor.getSession().on('change', function () {
      $('#sourceCodeTextarea').val(editor.getValue())
    })

    $('#sourceCodeTextarea').on('change', function () {
      editor.setValue($(this).val(), 1)
    })

    $form.on('submit', preSubmit)

    if (!first) {
      if (code) setCode(code)
      if (srcFile) $form.find('[name=sourceFile]').replaceWith(srcFile)
    }

    doRegenerateOnSubmit = false

    if (!doNotRegenerateOnSubmit) {
      delay(1000 * 60 * regenerateInterval).then(() => { doRegenerateOnSubmit = true })
    }

    return true
  }

  function setAceMode () {
    var filePath = extensionMap[$programType.val()]
    const mode = modelist.getModeForPath(filePath).mode
    if (editor) editor.session.setMode(mode)
  }

  function applyEditorVisibility () {
    if ($('#toggleEditorCheckbox').is(':checked')) {
      $('#editor').hide()
      $('#sourceCodeTextarea').show()
      $('.tabSizeDiv').hide()
    } else {
      $('#editor').show()
      editor.setValue(editor.getValue())
      $('#sourceCodeTextarea').hide()
      $('.tabSizeDiv').show()
    }
  }

  function updateFilesAndLimits () {
    var problemFiles = $('#submittedProblemFiles')
    var problemLimits = $('#submittedProblemLimits')

    var problemIndex = $('select[name=submittedProblemIndex]').val()
    var option = $('select[name=submittedProblemIndex] option:selected')

    var timeLimit = option.attr('data-time-limit')
    var memoryLimit = option.attr('data-memory-limit')
    var inputFile = option.attr('data-input-file')
    var outputFile = option.attr('data-output-file')

    if (problemIndex === '') {
      problemFiles.text('')
      problemLimits.text('')
    } else {
      var filesStyle = 'float: left; font-weight: bold'
      if (inputFile === '') {
        if (outputFile === '') {
          filesStyle = 'float: left;'
          problemFiles.text('standard input/output')
        } else {
          problemFiles.text('standard input / ' + outputFile)
        }
      } else {
        if (outputFile === '') {
          problemFiles.text(inputFile + ' / standard output')
        } else {
          problemFiles.text(inputFile + ' / ' + outputFile)
        }
      }

      problemFiles.attr('style', filesStyle)
      problemLimits.text(timeLimit + ' s, ' + memoryLimit + ' MB')
    }
  }

  function removeForm () {
    $('.submit-form').remove()
  }

  function preSubmit () {
    if (doRegenerateOnSubmit) {
      initAppendForm(false, true).then(() => {
        $form.trigger('submit')
      })
      return false
    }
    const button = $form.find('input.submit')
    const img = $form.find('img.ajax-loading-gif')
    if ($(this).hasAttr('data-submitting')) {
      return true
    }
    if (button.prop('disabled')) {
      return false
    }
    var result = callback.call(this)
    let alwaysDisable = false
    if (result || alwaysDisable) {
      img.show()
      button.prop('disabled', true)
      setTimeout(function () {
        img.hide()
        button.prop('disabled', false)
      }, alwaysDisable ? 1000 : 10000)
    }
    return result
  }

  function callback () {
    var form = $(this)
    var $ftaa = form.find("input[name='ftaa']")
    var $bfaa = form.find("input[name='bfaa']")

    if (window._ftaa && window._bfaa) {
      $ftaa.val(window._ftaa)
      $bfaa.val(window._bfaa)
    }

    if (form.attr('enctype') === 'multipart/form-data') {
      var sourceFiles = form.find('.table-form input[name=sourceFile]')

      if (
        sourceFiles.length === 1 &&
        sourceFiles[0].files &&
        sourceFiles[0].files.length === 0
      ) {
        form.removeAttr('enctype')
      }
    }

    return true
  }

  function getCode () {
    const $el = $('#sourceCodeTextarea')
    return $el.val()
  }

  function setCode (code) {
    const $el = $('#sourceCodeTextarea')
    $el.val(code)
    $el.trigger('change')
  }

  /* eslint-disable */
  // from contest submit page (/contest/****/submit) {{{

  function updateProblemLockInfo () {
    var problemIndex = $('select[name=submittedProblemIndex]').val()

    updateFilesAndLimits()
    if (problemIndex != '') {
      $.post('/data/problemLock',
        {action: 'checkProblemLock', contestId, participantId, problemIndex: problemIndex},
        function (response) {
          if (response['problemLocked'] == 'true') {
            Codeforces.setAjaxFormErrors('form table',
              {error__submittedProblemIndex: 'Problem was locked for submission, it is impossible to resubmit it'})
            $('.submit-form :submit').attr('disabled', 'disabled')

            $('#submittedProblemFiles').text('')
            $('#submittedProblemLimits').text('')
          } else {
            Codeforces.clearAjaxFormErrors('form table')
            $('.submit-form :submit').removeAttr('disabled')
          }
        },
        'json'
      )
    } else {
      Codeforces.clearAjaxFormErrors('form table')
      $('.submit-form :submit').attr('disabled', 'disabled')
    }
  }
  function updateSubmitButtonState () {
    var problemIndex = $('select[name=submittedProblemIndex]').val()

    updateFilesAndLimits()
    if (problemIndex == '') {
      $('.submit-form :submit').attr('disabled', 'disabled')
    } else {
      $('.submit-form :submit').removeAttr('disabled')
    }
  }
  // }}}
  /* eslint-enable */
})()
