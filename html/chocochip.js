// @ts-check

/**
 * @param {any} selector
 * @returns {HTMLElement | null} */
function $(selector) { return document.querySelector(selector) }

/**
 * @param {string} selector
 * @returns {NodeListOf<HTMLElement> | null} */
function $all(selector) { return document.querySelectorAll(selector) }

/**
 * @param {string} id
 * @returns {HTMLElement | null} */
function $id(id) { return document.getElementById(id) }

/**
 * @param {string} input
 * @returns {string} */
function stripFileExt(input) { return input.substring(0, input.lastIndexOf('.')) || input }