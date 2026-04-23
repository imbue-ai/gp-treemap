/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "ExportAsTextDialogControl.h"

#include "RawTreeWriterOptions.h"

@interface ExportAsTextDialogControl (PrivateMethods)

- (void) updateButton:(NSButton *)button basedOnOptions:(RawTreeWriterOptions *)options;
- (void) updateOptions:(RawTreeWriterOptions *)options basedOnButton:(NSButton *)button;

@end

@implementation ExportAsTextDialogControl

- (NSString *)windowNibName {
  return @"ExportAsTextDialog";
}

- (void)windowDidLoad {
  [super windowDidLoad];

  RawTreeWriterOptions*  initialOptions = [RawTreeWriterOptions defaultOptions];

  [self updateButton: addPathColumn basedOnOptions: initialOptions];
  [self updateButton: addFilenameColumn basedOnOptions: initialOptions];
  [self updateButton: addSizeColumn basedOnOptions: initialOptions];
  [self updateButton: addTypeColumn basedOnOptions: initialOptions];
  [self updateButton: addCreationTimeColumn basedOnOptions: initialOptions];
  [self updateButton: addModificationTimeColumn basedOnOptions: initialOptions];
  [self updateButton: addLastAccessTimeColumn basedOnOptions: initialOptions];

  addHeaders.state = initialOptions.headersEnabled ? NSControlStateValueOn : NSControlStateValueOff;

  [self.window makeKeyAndOrderFront: self];
}

- (IBAction) okAction:(id)sender {
  [NSApp stopModal];
}

- (IBAction) cancelAction:(id)sender {
  [NSApp abortModal];
}

- (RawTreeWriterOptions *)rawTreeWriterOptions {
  RawTreeWriterOptions*  options = [RawTreeWriterOptions defaultOptions];

  [self updateOptions: options basedOnButton: addPathColumn];
  [self updateOptions: options basedOnButton: addFilenameColumn];
  [self updateOptions: options basedOnButton: addSizeColumn];
  [self updateOptions: options basedOnButton: addTypeColumn];
  [self updateOptions: options basedOnButton: addCreationTimeColumn];
  [self updateOptions: options basedOnButton: addModificationTimeColumn];
  [self updateOptions: options basedOnButton: addLastAccessTimeColumn];

  [options setHeadersEnabled: addHeaders.state == NSControlStateValueOn];

  return options;
}

@end // @implementation ExportAsTextDialogControl

@implementation ExportAsTextDialogControl (PrivateMethods)

- (void) updateButton:(NSButton *)button basedOnOptions:(RawTreeWriterOptions *)options {
  button.state =
    [options isColumnShown: button.tag] ? NSControlStateValueOn : NSControlStateValueOff;
}

- (void) updateOptions:(RawTreeWriterOptions *)options basedOnButton:(NSButton *)button {
  if (button.state == NSControlStateValueOn) {
    [options showColumn: button.tag];
  } else {
    [options hideColumn: button.tag];
  }
}

@end // @implementation ExportAsTextDialogControl (PrivateMethods)
